import { describe, expect, it } from "vitest";
import type { AdminIdentity } from "../workers/admin-access";
import {
  createConfirmedOrderService,
  type AdminOrderFilters,
} from "../app/modules/proforma-invoice/application/confirmed-order-service";

const actor: AdminIdentity = {
  id: "admin-1",
  email: "admin@example.test",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};

const filters: AdminOrderFilters = {
  query: "",
  status: "all",
  stage: "all",
  from: "",
  to: "",
  country: "",
  productType: "all",
  sort: "newest",
  page: 1,
};

function fixtureDb(counts = { total: 2, confirmed: 1, held: 1 }) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, values: [] as unknown[] };
      calls.push(call);
      const statement = {
        bind(...values: unknown[]) {
          call.values = values;
          return statement;
        },
        async first() {
          return counts;
        },
        async all() {
          if (sql.includes("SELECT DISTINCT"))
            return { results: [{ code: "US" }] };
          return {
            results: [
              {
                id: "order:pi-1",
                order_number: "ORD-1",
                request_id: "rfq-1",
                reference_number: "QR-1",
                pi_id: "pi-1",
                document_number: "PI-1",
                customer_email: "buyer@example.test",
                customer_name: null,
                total_cents: 9400,
                confirmed_at: "2026-09-23T07:08:45.000Z",
                country_code: "US",
                held: 1,
                line_count: 2,
                shipment_count: 2,
                shipped_count: 1,
                delivered_count: 0,
                stage: "shipped",
                overdue_ready_count: 1,
                first_line_json: JSON.stringify({
                  displayName: "Adapter",
                  sku: "ADP-1",
                  lineKind: "standard",
                  product: { mainImageUrl: "/adapter.png" },
                  assembly: null,
                }),
                second_line_json: null,
              },
            ],
          };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, calls };
}

describe("admin confirmed order listing", () => {
  it("defaults to a bounded browsable page with summary fields", async () => {
    const { db, calls } = fixtureDb();
    const result = await createConfirmedOrderService(db).adminList(
      actor,
      filters,
    );
    expect(result.counts).toEqual({ all: 2, confirmed: 1, hold: 1 });
    expect(result.records[0]).toMatchObject({
      orderNumber: "ORD-1",
      customerName: "buyer@example.test",
      totalCents: 9400,
      status: "Payment Review Hold",
      lineCount: 2,
      stage: "shipped",
      shipmentCount: 2,
      shippedCount: 1,
      overdueReadyCount: 1,
      lines: [{ displayName: "Adapter", imageUrl: "/adapter.png" }],
    });
    expect(
      calls.find(({ sql }) => sql.includes("LIMIT 25 OFFSET"))?.values,
    ).toEqual([0]);
    expect(calls.every(({ sql }) => !sql.includes("SELECT o.*"))).toBe(true);
    expect(
      calls.find(({ sql }) => sql.includes("LIMIT 25 OFFSET"))?.sql,
    ).toContain("ready.current_estimate_date<date('now','+8 hours')");
  });

  it("applies status, identity, destination, product, Beijing date and sort filters", async () => {
    const { db, calls } = fixtureDb();
    await createConfirmedOrderService(db).adminList(actor, {
      ...filters,
      query: "Buyer",
      status: "hold",
      from: "2026-09-20",
      to: "2026-09-23",
      country: "US",
      productType: "assembly",
      sort: "amount_desc",
      page: 2,
    });
    const list = calls.find(({ sql }) => sql.includes("LIMIT 25 OFFSET"));
    expect(list?.sql).toContain("guard.held=1");
    expect(list?.sql).toContain("confirmed_order_lines line");
    expect(list?.sql).toContain("date(o.confirmed_at,'+8 hours')");
    expect(list?.sql).toContain("o.total_cents DESC");
    expect(list?.values).toEqual([
      ...Array(9).fill("buyer"),
      "2026-09-20",
      "2026-09-23",
      "US",
      "configured_assembly",
      0,
    ]);
  });

  it("filters by fulfillment stage in both counts and the page query", async () => {
    const { db, calls } = fixtureDb();
    await createConfirmedOrderService(db).adminList(actor, {
      ...filters,
      stage: "shipped",
    });
    const list = calls.find(({ sql }) => sql.includes("LIMIT 25 OFFSET"));
    const count = calls.find(({ sql }) => sql.includes("count(*) AS total"));
    expect(list?.sql).toContain("THEN 'shipped'");
    expect(list?.values).toEqual(["shipped", 0]);
    expect(count?.values).toEqual(["shipped"]);
    await expect(
      createConfirmedOrderService(db).adminList(actor, {
        ...filters,
        stage: "lost" as AdminOrderFilters["stage"],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an unauthenticated admin caller", async () => {
    const { db, calls } = fixtureDb();
    await expect(
      createConfirmedOrderService(db).adminList(
        null as unknown as AdminIdentity,
        filters,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(calls).toHaveLength(0);
  });

  it("bounds the result page to 25 summaries", async () => {
    const { db, calls } = fixtureDb({ total: 51, confirmed: 51, held: 0 });
    const result = await createConfirmedOrderService(db).adminList(actor, {
      ...filters,
      page: 2,
    });
    expect(result.page).toBe(2);
    expect(result.pageCount).toBe(3);
    expect(
      calls.find(({ sql }) => sql.includes("LIMIT 25 OFFSET"))?.values,
    ).toEqual([25]);
  });
});
