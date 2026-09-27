import type { AdminIdentity } from "#workers/admin-access";
import { piSha256 } from "../../proforma-invoice/domain/proforma-invoice";
import { requireAfterSalesPermission } from "../domain/permissions";
import {
  convenienceReturnCutoffForDate,
  isOnOrBefore,
  LAUNCH_RETURN_POLICY,
} from "../domain/return-policy";
import { customerMessageStatements } from "../infrastructure/d1-customer-messages";
import {
  createD1OrderFacts,
  type OrderFacts,
} from "../infrastructure/d1-order-facts";
import { afterSalesCommandId, afterSalesText } from "./cancellation-service";

export type CaseReason =
  "convenience_return" | "wrong_item" | "damaged" | "nonconforming" | "other";

export const caseReasons: readonly CaseReason[] = [
  "convenience_return",
  "wrong_item",
  "damaged",
  "nonconforming",
  "other",
];

interface CaseRow {
  id: string;
  case_number: string;
  order_id: string;
  profile_id: string;
  reason: CaseReason;
  description: string;
  policy_version: string;
  status: "open" | "closed";
  version: number;
  created_at: string;
  updated_at: string;
}

const hash = (value: string) => piSha256(new TextEncoder().encode(value));
const conflict = () =>
  new Response("After-sales Case changed; reload", { status: 409 });

/** Delivered, not-yet-claimed physical quantities by Shipment and line. */
export async function claimableQuantities(
  db: D1Database,
  orderFacts: OrderFacts,
  at: string,
) {
  const [dispatched, claimed] = await Promise.all([
    db
      .prepare(
        `SELECT shipment_id,line_id,sum(physical_quantity) AS quantity
         FROM shipment_dispatch_quantities WHERE order_id=?
         GROUP BY shipment_id,line_id`,
      )
      .bind(orderFacts.orderId)
      .all<{ shipment_id: string; line_id: string; quantity: number }>(),
    db
      .prepare(
        `SELECT shipment_id,line_id,sum(physical_quantity) AS quantity
         FROM after_sales_case_lines WHERE order_id=?
         GROUP BY shipment_id,line_id`,
      )
      .bind(orderFacts.orderId)
      .all<{ shipment_id: string; line_id: string; quantity: number }>(),
  ]);
  return dispatched.results.flatMap((row) => {
    const shipment = orderFacts.shipments.find(
      (item) => item.id === row.shipment_id,
    );
    const line = orderFacts.lines.find((item) => item.lineId === row.line_id);
    if (!shipment || !line || !shipment.deliveredDate) return [];
    const already =
      claimed.results.find(
        (item) =>
          item.shipment_id === row.shipment_id && item.line_id === row.line_id,
      )?.quantity ?? 0;
    const cutoff =
      shipment.deliveredDate && line.productClass === "standard"
        ? convenienceReturnCutoffForDate(shipment.deliveredDate)
        : null;
    return [
      {
        lineId: line.lineId,
        lineNumber: line.lineNumber,
        displayName: line.displayName,
        sku: line.sku,
        productClass: line.productClass,
        pieceLengthFt: line.pieceLengthFt,
        shipmentId: shipment.id,
        shipmentName: shipment.displayName,
        deliveredDateEt: shipment.deliveredDate,
        deliveredQuantity: row.quantity,
        available: Math.max(0, row.quantity - already),
        convenienceCutoffAt: cutoff?.at ?? null,
        convenienceCutoffDateEt: cutoff?.dateEt ?? null,
        convenienceOpen: cutoff ? isOnOrBefore(at, cutoff.at) : false,
      },
    ];
  });
}

export function createCaseService(
  db: D1Database,
  options: { now?: () => Date; auditIp?: string | null } = {},
) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const facts = createD1OrderFacts(db);

  async function caseRows(where: string, ...bindings: unknown[]) {
    return (
      await db
        .prepare(`SELECT * FROM after_sales_cases ${where}`)
        .bind(...bindings)
        .all<CaseRow>()
    ).results;
  }

  async function project(
    orderFacts: OrderFacts,
    rows: CaseRow[],
    audience: "customer" | "admin",
  ) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const [lines, messages, files] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM after_sales_case_lines WHERE case_id IN (${placeholders})`,
        )
        .bind(...ids)
        .all<{
          case_id: string;
          line_id: string;
          shipment_id: string;
          physical_quantity: number;
          product_class: string;
          delivered_date_et: string;
          convenience_cutoff_at: string | null;
        }>(),
      db
        .prepare(
          `SELECT * FROM after_sales_case_messages WHERE case_id IN (${placeholders})
           ${audience === "customer" ? "AND visibility='customer'" : ""}
           ORDER BY created_at,rowid`,
        )
        .bind(...ids)
        .all<{
          id: string;
          case_id: string;
          author_role: string;
          author_id: string;
          visibility: string;
          kind: string;
          body: string;
          created_at: string;
        }>(),
      db
        .prepare(
          `SELECT id,scope_id,filename,uploader_role,visibility,share_reason,created_at
           FROM after_sales_files WHERE scope_kind='case' AND scope_id IN (${placeholders})
           ${audience === "customer" ? "AND visibility IN ('customer','shared')" : ""}
           ORDER BY created_at,id`,
        )
        .bind(...ids)
        .all<{
          id: string;
          scope_id: string;
          filename: string;
          uploader_role: string;
          visibility: string;
          share_reason: string | null;
          created_at: string;
        }>(),
    ]);
    return rows.map((row) => ({
      id: row.id,
      caseNumber: row.case_number,
      orderId: row.order_id,
      reason: row.reason,
      description: row.description,
      policyVersion: row.policy_version,
      status: row.status,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lines: lines.results
        .filter((line) => line.case_id === row.id)
        .map((line) => {
          const orderLine = orderFacts.lines.find(
            (item) => item.lineId === line.line_id,
          );
          return {
            lineId: line.line_id,
            lineNumber: orderLine?.lineNumber ?? 0,
            displayName: orderLine?.displayName ?? line.line_id,
            sku: orderLine?.sku ?? "",
            pieceLengthFt: orderLine?.pieceLengthFt ?? null,
            shipmentId: line.shipment_id,
            shipmentName:
              orderFacts.shipments.find((item) => item.id === line.shipment_id)
                ?.displayName ?? line.shipment_id,
            physicalQuantity: line.physical_quantity,
            productClass: line.product_class,
            deliveredDateEt: line.delivered_date_et,
            convenienceCutoffAt: line.convenience_cutoff_at,
          };
        })
        .sort((a, b) => a.lineNumber - b.lineNumber),
      messages: messages.results
        .filter((message) => message.case_id === row.id)
        .map((message) => ({
          id: message.id,
          authorRole: message.author_role,
          visibility: message.visibility,
          kind: message.kind,
          body: message.body,
          createdAt: message.created_at,
          ...(audience === "admin" ? { authorId: message.author_id } : {}),
        })),
      files: files.results
        .filter((file) => file.scope_id === row.id)
        .map((file) => ({
          id: file.id,
          filename: file.filename,
          uploaderRole: file.uploader_role,
          visibility: file.visibility,
          shareReason: file.share_reason,
          createdAt: file.created_at,
        })),
    }));
  }

  async function message(input: {
    caseRow: CaseRow;
    orderFacts: OrderFacts;
    authorRole: "customer" | "admin";
    authorId: string;
    visibility: "customer" | "internal";
    body: string;
    commandId: string;
  }) {
    const commandHash = await hash(
      JSON.stringify({
        caseId: input.caseRow.id,
        authorId: input.authorId,
        visibility: input.visibility,
        body: input.body,
      }),
    );
    const replay = await db
      .prepare(
        `SELECT id,command_hash FROM after_sales_case_messages WHERE command_id=?`,
      )
      .bind(input.commandId)
      .first<{ id: string; command_hash: string }>();
    if (replay) {
      if (replay.command_hash !== commandHash) throw conflict();
      return replay.id;
    }
    const id = crypto.randomUUID();
    const timestamp = now();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO after_sales_case_messages
           (id,case_id,author_role,author_id,visibility,kind,body,created_at,
            command_id,command_hash)
           SELECT ?,?,?,?,?,'message',?,?,?,? WHERE EXISTS(
             SELECT 1 FROM after_sales_cases WHERE id=? AND order_id=?)`,
        )
        .bind(
          id,
          input.caseRow.id,
          input.authorRole,
          input.authorId,
          input.visibility,
          input.body,
          timestamp,
          input.commandId,
          commandHash,
          input.caseRow.id,
          input.orderFacts.orderId,
        ),
      db
        .prepare(
          `UPDATE after_sales_cases SET version=version+1,updated_at=?
           WHERE id=? AND EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)`,
        )
        .bind(timestamp, input.caseRow.id, id),
    ];
    if (input.authorRole === "admin" && input.visibility === "customer")
      statements.push(
        ...(await customerMessageStatements(db, {
          orderRequestId: input.orderFacts.requestId,
          actorId: input.authorId,
          messageId: `after-sales-message:${input.commandId}`,
          body: `New message about After-sales Case ${input.caseRow.case_number} for Order ${input.orderFacts.orderNumber}: ${input.body} — Reply from the Case in your Order so the seller keeps it with this case.`,
          timestamp,
          guard: {
            sql: "EXISTS(SELECT 1 FROM after_sales_case_messages WHERE id=?)",
            bindings: [id],
          },
        })),
      );
    try {
      await db.batch(statements);
    } catch {
      const concurrent = await db
        .prepare(
          `SELECT id,command_hash FROM after_sales_case_messages WHERE command_id=?`,
        )
        .bind(input.commandId)
        .first<{ id: string; command_hash: string }>();
      if (concurrent?.command_hash === commandHash) return concurrent.id;
      throw conflict();
    }
    return id;
  }

  async function ownedCase(profileId: string, orderId: string, caseId: string) {
    const owned = await facts.ownedOrder(profileId, orderId);
    const [row] = await caseRows("WHERE id=? AND order_id=?", caseId, owned);
    if (!row) throw new Response("Case not found", { status: 404 });
    return { row, orderFacts: await facts.read(owned) };
  }

  return {
    async customerRead(profileId: string, orderId: string) {
      const owned = await facts.ownedOrder(profileId, orderId);
      const orderFacts = await facts.read(owned);
      const timestamp = now();
      return {
        claimable: (await claimableQuantities(db, orderFacts, timestamp)).map(
          ({ convenienceCutoffAt, ...item }) => ({
            ...item,
            convenienceCutoffAt,
          }),
        ),
        undeliveredShipments: orderFacts.shipments
          .filter((shipment) => shipment.handedOff && !shipment.deliveredDate)
          .map((shipment) => shipment.displayName),
        cases: await project(
          orderFacts,
          await caseRows(
            "WHERE order_id=? ORDER BY created_at DESC,id DESC",
            owned,
          ),
          "customer",
        ),
      };
    },

    async adminRead(actor: AdminIdentity, orderId: string) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const orderFacts = await facts.read(orderId);
      return project(
        orderFacts,
        await caseRows(
          "WHERE order_id=? ORDER BY created_at DESC,id DESC",
          orderId,
        ),
        "admin",
      );
    },

    async adminList(
      actor: AdminIdentity,
      input: { status: "open" | "closed" | "all"; page: number },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const pageSize = 50;
      const page =
        Number.isSafeInteger(input.page) && input.page > 0 ? input.page : 1;
      const where = input.status === "all" ? "" : "WHERE c.status=?1";
      const bindings = input.status === "all" ? [] : [input.status];
      const [rows, total] = await Promise.all([
        db
          .prepare(
            `SELECT c.id,c.case_number,c.order_id,c.reason,c.status,c.created_at,
               c.updated_at,o.order_number,
               (SELECT max(m.created_at) FROM after_sales_case_messages m
                 WHERE m.case_id=c.id AND m.author_role='customer') AS last_customer_at
             FROM after_sales_cases c JOIN confirmed_orders o ON o.id=c.order_id
             ${where} ORDER BY c.updated_at DESC,c.id DESC
             LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
          )
          .bind(...bindings)
          .all<{
            id: string;
            case_number: string;
            order_id: string;
            reason: CaseReason;
            status: string;
            created_at: string;
            updated_at: string;
            order_number: string;
            last_customer_at: string | null;
          }>(),
        db
          .prepare(`SELECT count(*) AS count FROM after_sales_cases c ${where}`)
          .bind(...bindings)
          .first<number>("count"),
      ]);
      return {
        page,
        total: total ?? 0,
        pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
        records: rows.results.map((row) => ({
          id: row.id,
          caseNumber: row.case_number,
          orderId: row.order_id,
          orderNumber: row.order_number,
          reason: row.reason,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastCustomerAt: row.last_customer_at,
        })),
      };
    },

    async customerOpen(
      profileId: string,
      input: {
        orderId: string;
        reason: string;
        description: string;
        lines: unknown;
        commandId: string;
      },
    ) {
      const commandId = afterSalesCommandId(input.commandId);
      if (!caseReasons.includes(input.reason as CaseReason))
        throw new Response("Choose a reason", { status: 400 });
      const reason = input.reason as CaseReason;
      const description = afterSalesText(
        input.description,
        "Description",
        5000,
      );
      if (
        !Array.isArray(input.lines) ||
        input.lines.length < 1 ||
        input.lines.length > 100
      )
        throw new Response("Select delivered quantities", { status: 400 });
      const selected = input.lines.map((value) => {
        const item = (value ?? {}) as Record<string, unknown>;
        if (
          !Number.isSafeInteger(item.physicalQuantity) ||
          (item.physicalQuantity as number) < 1
        )
          throw new Response("Invalid quantity", { status: 400 });
        return {
          lineId: afterSalesText(item.lineId, "Order line", 200),
          shipmentId: afterSalesText(item.shipmentId, "Shipment", 200),
          physicalQuantity: item.physicalQuantity as number,
        };
      });
      if (
        new Set(
          selected.map((item) => `${item.lineId}\u0000${item.shipmentId}`),
        ).size !== selected.length
      )
        throw new Response("Duplicate order line", { status: 400 });
      const orderId = await facts.ownedOrder(profileId, input.orderId);
      const commandHash = await hash(
        JSON.stringify({ profileId, orderId, reason, description, selected }),
      );
      const replay = async () =>
        db
          .prepare(
            `SELECT id,submission_hash FROM after_sales_cases WHERE submission_command_id=?`,
          )
          .bind(commandId)
          .first<{ id: string; submission_hash: string }>();
      const prior = await replay();
      if (prior) {
        if (prior.submission_hash !== commandHash) throw conflict();
        return prior.id;
      }
      const orderFacts = await facts.read(orderId);
      const timestamp = now();
      const claimable = await claimableQuantities(db, orderFacts, timestamp);
      const lines = selected.map((item) => {
        const available = claimable.find(
          (candidate) =>
            candidate.lineId === item.lineId &&
            candidate.shipmentId === item.shipmentId,
        );
        if (!available || !available.deliveredDateEt)
          throw new Response(
            "Only delivered quantities can be claimed; contact Support about undelivered items",
            { status: 400 },
          );
        if (item.physicalQuantity > available.available) throw conflict();
        if (reason === "convenience_return") {
          if (available.productClass !== "standard")
            throw new Response(
              "Made-to-order products and cut hose are not eligible for convenience return; report a problem instead",
              { status: 400 },
            );
          if (!available.convenienceOpen)
            throw new Response(
              "The 14-day convenience return window for this Shipment has closed; report a problem if the item is wrong or defective",
              { status: 400 },
            );
        }
        return { ...item, available };
      });
      const count = await db
        .prepare(
          `SELECT count(*) AS count FROM after_sales_cases WHERE order_id=?`,
        )
        .bind(orderId)
        .first<number>("count");
      const id = crypto.randomUUID();
      const caseNumber = `AS-${orderFacts.orderNumber}-${(count ?? 0) + 1}`;
      const statements: D1PreparedStatement[] = [
        db
          .prepare(
            `INSERT INTO after_sales_cases
             (id,case_number,order_id,profile_id,reason,description,policy_version,
              status,submission_command_id,submission_hash,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,'open',?,?,?,?)`,
          )
          .bind(
            id,
            caseNumber,
            orderId,
            profileId,
            reason,
            description,
            LAUNCH_RETURN_POLICY.version,
            commandId,
            commandHash,
            timestamp,
            timestamp,
          ),
        ...lines.map((line) =>
          db
            .prepare(
              `INSERT INTO after_sales_case_lines
               (case_id,order_id,line_id,shipment_id,physical_quantity,product_class,
                delivered_date_et,convenience_cutoff_at,line_facts_json)
               VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .bind(
              id,
              orderId,
              line.lineId,
              line.shipmentId,
              line.physicalQuantity,
              line.available.productClass,
              line.available.deliveredDateEt,
              line.available.convenienceCutoffAt,
              JSON.stringify({
                sku: line.available.sku,
                displayName: line.available.displayName,
                pieceLengthFt: line.available.pieceLengthFt,
                deliveredQuantity: line.available.deliveredQuantity,
              }),
            ),
        ),
        db
          .prepare(
            `INSERT INTO admin_audit_events
             (id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
             VALUES (?,'order.after_sales_case_opened','confirmed_order',?,?,?,?)`,
          )
          .bind(
            `after-sales-case:${id}`,
            orderId,
            profileId,
            JSON.stringify({
              caseId: id,
              caseNumber,
              reason,
              lines: selected,
              commandId,
              ipAddress: options.auditIp ?? null,
            }),
            timestamp,
          ),
      ];
      try {
        await db.batch(statements);
      } catch {
        const concurrent = await replay();
        if (concurrent?.submission_hash === commandHash) return concurrent.id;
        throw conflict();
      }
      return id;
    },

    async customerReply(
      profileId: string,
      input: {
        orderId: string;
        caseId: string;
        body: string;
        commandId: string;
      },
    ) {
      const commandId = afterSalesCommandId(input.commandId);
      const body = afterSalesText(input.body, "Message", 5000);
      const { row, orderFacts } = await ownedCase(
        profileId,
        input.orderId,
        input.caseId,
      );
      return message({
        caseRow: row,
        orderFacts,
        authorRole: "customer",
        authorId: profileId,
        visibility: "customer",
        body,
        commandId,
      });
    },

    async adminReply(
      actor: AdminIdentity,
      input: {
        orderId: string;
        caseId: string;
        body: string;
        visibility: "customer" | "internal";
        commandId: string;
      },
    ) {
      requireAfterSalesPermission(actor, "after_sales.review");
      const commandId = afterSalesCommandId(input.commandId);
      const body = afterSalesText(input.body, "Message", 5000);
      if (!["customer", "internal"].includes(input.visibility))
        throw new Response("Choose message visibility", { status: 400 });
      const [row] = await caseRows(
        "WHERE id=? AND order_id=?",
        input.caseId,
        input.orderId,
      );
      if (!row) throw new Response("Case not found", { status: 404 });
      return message({
        caseRow: row,
        orderFacts: await facts.read(input.orderId),
        authorRole: "admin",
        authorId: actor.id,
        visibility: input.visibility,
        body,
        commandId,
      });
    },

    ownedCase,
  };
}

export type CaseService = ReturnType<typeof createCaseService>;
export type CaseView = Awaited<ReturnType<CaseService["adminRead"]>>[number];
export type CustomerCases = Awaited<ReturnType<CaseService["customerRead"]>>;
