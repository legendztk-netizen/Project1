import {
  planItemImport,
  type ImportBaseline,
  type ImportSource,
} from "../domain/catalog-item-import";
import {
  CatalogItemRejected,
  itemCode,
  type CatalogItemCommand,
  type CatalogItemPayload,
} from "../domain/catalog-item-publication";
import type { CatalogWorkbookSheet } from "../domain/catalog-workbook";
import { createD1CatalogItemRepository } from "./d1-catalog-item-repository";
import { createD1ProductManagementRepository } from "./d1-product-management-repository";
import { itemSeriesCode } from "./d1-additional-catalog-items";

interface RequestRow {
  id: string;
  payload_json: string;
  original_json: string;
  baseline_json: string | null;
  issues_json: string;
  dependencies_json: string;
  status: string;
  version: number;
  batch_id: string | null;
  created_by: string;
  created_at: string;
}
export interface ItemReviewRequest {
  id: string;
  command: CatalogItemCommand;
  original: ImportSource[];
  baseline: CatalogItemPayload | null;
  issues: string[];
  dependencies: string[];
  status: string;
  version: number;
  batchId: string | null;
  createdBy: string;
  createdAt: string;
}
function decode(r: RequestRow): ItemReviewRequest {
  return {
    id: r.id,
    command: JSON.parse(r.payload_json),
    original: JSON.parse(r.original_json),
    baseline: r.baseline_json ? JSON.parse(r.baseline_json) : null,
    issues: JSON.parse(r.issues_json),
    dependencies: JSON.parse(r.dependencies_json),
    status: r.status,
    version: r.version,
    batchId: r.batch_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}
function reviewError(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "findings" in error &&
    Array.isArray(error.findings)
  )
    return error.findings
      .map(
        (f: { field: string; message: string }) => `${f.field}：${f.message}`,
      )
      .join("；");
  if (error instanceof TypeError)
    return "产品必填数据不完整，请打开更多修正参数 / Required product data is incomplete";
  return error instanceof Error ? error.message : "审核失败";
}
export function createD1ItemImportReview(
  database: D1Database,
  actor?: { id: string; catalogPermission?: "view" | "edit" },
) {
  const items = createD1CatalogItemRepository(database);
  function audit(id: string, actor: string, event: string, payload: unknown) {
    return database
      .prepare(
        "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES(?,?,'product_change_request',?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        `catalog_item.${event}`,
        id,
        actor,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
  }
  async function get(id: string) {
    const row = await database
      .prepare("SELECT * FROM catalog_product_change_requests WHERE id=?")
      .bind(id)
      .first<RequestRow>();
    if (!row) throw new CatalogItemRejected("请求不存在", 404);
    return decode(row);
  }
  async function all() {
    return (
      await database
        .prepare(
          "SELECT * FROM catalog_product_change_requests ORDER BY created_at DESC,id",
        )
        .all<RequestRow>()
    ).results.map(decode);
  }
  async function requireItems(actorId: string) {
    if (!actor || actor.id !== actorId || actor.catalogPermission === "view")
      throw new CatalogItemRejected("需要产品编辑权限", 403);
    if ((await items.state()).mode !== "items")
      throw new CatalogItemRejected("条目发布尚未启用", 409);
  }
  async function persistTransition(
    row: ItemReviewRequest,
    actor: string,
    update: D1PreparedStatement,
    event: string,
    payload: unknown,
  ) {
    // A conditional audit insert keeps failed optimistic updates from leaving misleading success events.
    const eventId = crypto.randomUUID();
    const results = await database.batch([
      update,
      database
        .prepare(
          "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) SELECT ?,?,'product_change_request',?,?,?,? WHERE changes()=1",
        )
        .bind(
          eventId,
          `catalog_item.${event}`,
          row.id,
          actor,
          JSON.stringify(payload),
          new Date().toISOString(),
        ),
    ]);
    if (results[0].meta.changes !== 1)
      throw new CatalogItemRejected("请求已变更或已审核，请刷新", 409);
  }
  return {
    get,
    all,
    async batchSource(id: string) {
      return database
        .prepare(
          "SELECT original_json FROM catalog_item_import_batches WHERE id=?",
        )
        .bind(id)
        .first<{ original_json: string }>();
    },
    async importWorkbook(input: {
      batchId: string;
      fileName: string;
      fileSize: number;
      sheets: CatalogWorkbookSheet[];
      actorId: string;
      ipAddress: string;
    }) {
      await requireItems(input.actorId);
      if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.batchId))
        throw new CatalogItemRejected("批次标识无效");
      const existing = await database
        .prepare(
          "SELECT original_json,created_by FROM catalog_item_import_batches WHERE id=?",
        )
        .bind(input.batchId)
        .first<{ original_json: string; created_by: string }>();
      if (existing) {
        if (
          existing.original_json !== JSON.stringify(input.sheets) ||
          existing.created_by !== input.actorId
        )
          throw new CatalogItemRejected("批次标识已用于其他导入", 409);
        return input.batchId;
      }
      const generation = (await items.state()).generation;
      const managed = await createD1ProductManagementRepository(database).all();
      const cache = new Map<string, Promise<ImportBaseline | null>>();
      const plan = await planItemImport({
        ...input,
        baseline(type, kind, code) {
          const key = `${type}:${kind}:${code}`;
          if (!cache.has(key))
            cache.set(
              key,
              (async () => {
                const row = managed.find(
                  (r) =>
                    r.productType === type &&
                    r.kind === kind &&
                    r.code === code,
                );
                const payload = await items.findProductPayload(
                  type,
                  kind,
                  code,
                  row?.state === "draft",
                );
                return payload
                  ? {
                      payload,
                      state: (row?.state ??
                        "online") as CatalogItemCommand["targetState"],
                      revisionId: row?.revisionId ?? null,
                    }
                  : null;
              })(),
            );
          return cache.get(key)!;
        },
      });
      if ((await items.state()).generation !== generation)
        throw new CatalogItemRejected(
          "导入期间产品发生变化，请重试以取得一致基线",
          409,
        );
      const createdAt = new Date().toISOString();
      const statements: D1PreparedStatement[] = [
        database
          .prepare(
            "INSERT INTO catalog_item_import_batches(id,file_name,file_size_bytes,original_json,issues_json,created_by,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .bind(
            input.batchId,
            input.fileName,
            input.fileSize,
            JSON.stringify(input.sheets),
            JSON.stringify(plan.issues),
            input.actorId,
            createdAt,
          ),
      ];
      for (const p of plan.requests) {
        // Incomplete proposals remain editable. Domain validation is authoritative again at approval.
        if (!p.dependencies.length && !p.issues.length)
          try {
            await items.validateRequest(p.command);
          } catch (e) {
            p.issues.push(reviewError(e));
          }
        statements.push(
          database
            .prepare(
              "INSERT INTO catalog_product_change_requests(id,payload_json,original_json,source_json,dependencies_json,baseline_revision_id,target_state,created_by,created_at,issues_json,batch_id,baseline_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              p.id,
              JSON.stringify(p.command),
              JSON.stringify(p.sources),
              JSON.stringify(p.command.source),
              JSON.stringify(p.dependencies),
              p.command.baselineRevisionId,
              p.command.targetState,
              input.actorId,
              createdAt,
              JSON.stringify(p.issues),
              input.batchId,
              p.baseline ? JSON.stringify(p.baseline) : null,
            ),
        );
        statements.push(
          audit(p.id, input.actorId, "request_created", {
            source: p.command.source,
            dependencies: p.dependencies,
            issues: p.issues,
          }),
        );
      }
      for (const r of plan.relations)
        statements.push(
          database
            .prepare(
              "INSERT INTO catalog_pending_relation_sources(id,batch_id,source_json,issues_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              r.id,
              input.batchId,
              JSON.stringify(r.source),
              JSON.stringify(r.issues),
              input.actorId,
              createdAt,
            ),
        );
      statements.push(
        audit(input.batchId, input.actorId, "workbook_imported", {
          requests: plan.requests.length,
          relations: plan.relations.length,
          issues: plan.issues,
        }),
      );
      await database.batch(statements);
      return input.batchId;
    },
    async batches() {
      return (
        await database
          .prepare(
            "SELECT id,file_name,issues_json,created_by,created_at FROM catalog_item_import_batches ORDER BY created_at DESC",
          )
          .all<{
            id: string;
            file_name: string;
            issues_json: string;
            created_by: string;
            created_at: string;
          }>()
      ).results;
    },
    async relations(batchId?: string) {
      return (
        await database
          .prepare(
            `SELECT * FROM catalog_pending_relation_sources ${batchId ? "WHERE batch_id=?" : ""} ORDER BY created_at DESC`,
          )
          .bind(...(batchId ? [batchId] : []))
          .all<{
            id: string;
            batch_id: string;
            source_json: string;
            issues_json: string;
            status: string;
          }>()
      ).results;
    },
    async correct(input: {
      id: string;
      version: number;
      payload: CatalogItemPayload;
      targetState: CatalogItemCommand["targetState"];
      actorId: string;
      ipAddress: string;
      reason: string;
    }) {
      await requireItems(input.actorId);
      const row = await get(input.id);
      if (!input.reason.trim()) throw new CatalogItemRejected("请输入修正说明");
      if (row.status !== "pending" || row.version !== input.version)
        throw new CatalogItemRejected("请求已变更，请刷新", 409);
      if (
        input.payload.kind !== row.command.payload.kind ||
        input.payload.productType !== row.command.payload.productType ||
        itemCode(input.payload) !== itemCode(row.command.payload)
      )
        throw new CatalogItemRejected("修正不能更换请求的产品身份");
      const command = {
        ...row.command,
        payload: input.payload,
        targetState: input.targetState,
      };
      const issues: string[] = [];
      try {
        await items.validateRequest({
          ...command,
          actorId: input.actorId,
          ipAddress: input.ipAddress,
        });
      } catch (e) {
        if (!row.dependencies.length) issues.push(reviewError(e));
      }
      // A new parent can be approved separately; keep the dependency reason visible until it is available.
      await persistTransition(
        row,
        input.actorId,
        database
          .prepare(
            "UPDATE catalog_product_change_requests SET payload_json=?,target_state=?,issues_json=?,version=version+1 WHERE id=? AND version=? AND status='pending'",
          )
          .bind(
            JSON.stringify(command),
            command.targetState,
            JSON.stringify(issues),
            row.id,
            input.version,
          ),
        "request_corrected",
        {
          before: row.command,
          after: command,
          reason: input.reason,
          version: input.version,
          issues,
        },
      );
      return { issues };
    },
    async review(input: {
      selected: { id: string; version: number }[];
      intent: "approve" | "reject" | "delete";
      actorId: string;
      ipAddress: string;
    }) {
      await requireItems(input.actorId);
      const unique = [
        ...new Map(input.selected.map((r) => [r.id, r])).values(),
      ];
      if (!unique.length || unique.length > 200)
        throw new CatalogItemRejected("请选择 1–200 个请求");
      const results: {
        id: string;
        code: string;
        ok: boolean;
        message: string;
      }[] = [];
      const loaded = await Promise.all(
        unique.map(async (selection) => {
          try {
            return { selection, row: await get(selection.id) };
          } catch (error) {
            results.push({
              id: selection.id,
              code: selection.id,
              ok: false,
              message: reviewError(error),
            });
            return null;
          }
        }),
      );
      const entries = loaded.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      entries.sort(
        (a, b) =>
          Number(a.row.command.payload.kind === "sku") -
          Number(b.row.command.payload.kind === "sku"),
      );
      for (const { selection, row } of entries) {
        const code = itemCode(row.command.payload);
        try {
          if (row.version !== selection.version)
            throw new CatalogItemRejected("请求已修正，请刷新后再审核", 409);
          if (row.status === "approved" && input.intent === "approve") {
            results.push({
              id: row.id,
              code,
              ok: true,
              message: "已批准；重试未重复发布",
            });
            continue;
          }
          if (row.status !== "pending")
            throw new CatalogItemRejected("仅待审核请求可操作");
          if (input.intent !== "approve") {
            const status = input.intent === "reject" ? "rejected" : "deleted";
            await persistTransition(
              row,
              input.actorId,
              database
                .prepare(
                  "UPDATE catalog_product_change_requests SET status=?,version=version+1 WHERE id=? AND status='pending' AND version=?",
                )
                .bind(status, row.id, row.version),
              `request_${status}`,
              { version: row.version },
            );
          } else {
            // Revalidate after parent approvals in this batch. Import issues require an explicit audited correction.
            if (row.command.payload.kind === "sku" && row.batchId) {
              const related = (await all()).find(
                (r) =>
                  r.batchId === row.batchId &&
                  r.command.payload.kind === "series" &&
                  r.command.payload.productType ===
                    row.command.payload.productType &&
                  itemCode(r.command.payload) ===
                    itemSeriesCode(row.command.payload),
              );
              if (related?.issues.length)
                throw new CatalogItemRejected(
                  "相关系列请求仍有错误，请先修正系列数据",
                );
            }
            if (row.issues.length)
              throw new CatalogItemRejected(row.issues.join("；"));
            if (row.dependencies.length) {
              const parent = await database
                .prepare(
                  "SELECT target_state FROM catalog_item_current WHERE kind='series' AND product_type=? AND code=?",
                )
                .bind(
                  row.command.payload.productType,
                  itemSeriesCode(row.command.payload),
                )
                .first<{ target_state: string }>();
              const dependencies = await Promise.all(row.dependencies.map(get));
              if (dependencies.some((d) => d.status !== "approved")) {
                if (parent?.target_state !== "online")
                  throw new CatalogItemRejected("系列依赖未批准或未上线");
                await persistTransition(
                  row,
                  input.actorId,
                  database
                    .prepare(
                      "UPDATE catalog_product_change_requests SET dependencies_json='[]',version=version+1 WHERE id=? AND status='pending' AND version=?",
                    )
                    .bind(row.id, row.version),
                  "request_dependency_resolved",
                  {
                    dependencies: row.dependencies,
                    reason: "已有有效上线系列",
                  },
                );
                row.version += 1;
              }
            }
            await items.approveRequest(
              row.id,
              input.actorId,
              input.ipAddress,
              row.version,
            );
          }
          results.push({
            id: row.id,
            code,
            ok: true,
            message:
              input.intent === "approve"
                ? "已批准"
                : input.intent === "reject"
                  ? "已拒绝"
                  : "已删除请求，产品未回滚",
          });
        } catch (e) {
          results.push({
            id: row.id,
            code,
            ok: false,
            message: reviewError(e),
          });
        }
      }
      return results;
    },
  };
}
