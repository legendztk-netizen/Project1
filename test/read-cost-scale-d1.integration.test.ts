import { afterAll, beforeAll, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { startAfterSalesDatabase } from "./fixtures/after-sales-order";
import { seedManagedAssemblyBaseline } from "./fixtures/managed-assembly-baseline";
import { metered } from "./fixtures/metered-d1";
import { legacyAdminThreads } from "./fixtures/legacy-admin-message-threads";
import { createD1MessageCenter } from "../app/modules/message-center/infrastructure/d1-message-center";
import {
  clearPublicCatalogCache,
  createD1PublicCatalogRepository,
} from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { createD1ProductManagementRepository } from "../app/modules/catalog/infrastructure/d1-product-management-repository";
import { createD1ManagedAssemblies } from "../app/modules/catalog/infrastructure/d1-managed-assemblies";
import { createD1ConfiguratorRepository } from "../app/modules/configurator/infrastructure/d1-configurator-repository";
import { createD1AdminQuoteReviewRepository } from "../app/modules/quote-review/infrastructure/d1-admin-quote-review-repository";

// Local workerd/D1 only. Synthetic volume tests measure core page queries, not
// browser latency, production traffic or the complete request's authorization cost.
const BULK = 2000;
let db: D1Database;
let dispose: () => Promise<void>;
const measurements: Record<string, number> = {};
async function measure<T>(
  name: string,
  run: (binding: D1Database) => Promise<T>,
) {
  const measured = metered(db);
  const result = await run(measured.binding);
  measurements[name] = measured.counter.reads;
  return result;
}
async function history(first: number, last: number) {
  await db
    .prepare(
      `WITH RECURSIVE n(x) AS (VALUES(?) UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO quote_conversation_messages(id,request_id,author_role,author_id,body,created_at,command_id,payload_hash,source,delivery_state)
    SELECT c.request_id||'-message-'||printf('%04d',x),c.request_id,
      CASE WHEN (CAST(substr(c.request_id,7) AS INTEGER)+x)%3=0 THEN 'admin' ELSE 'customer' END,
      'fixture','Message '||x,'2026-09-25T12:00:00.000Z',c.request_id||'-command-'||x,'fixture','website','available'
    FROM quote_conversations c,n WHERE c.request_id LIKE 'scale-%'`,
    )
    .bind(first, last)
    .run();
}
beforeAll(async () => {
  ({ db, dispose } = await startAfterSalesDatabase("read-cost-scale"));
  await seedManagedAssemblyBaseline(db, BULK);
  await createD1ManagedAssemblies(db, {
    id: "owner-1",
    catalogPermission: "edit",
  }).update({ id: "scale-assemblies", ipAddress: "local" });
  await db
    .prepare(
      `WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<1000)
    INSERT INTO customer_quote_requests
      (id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at)
    SELECT 'scale-'||printf('%04d',i),'QR-SCALE-'||printf('%04d',i),
      CASE WHEN i%2=0 THEN 'buyer' ELSE 'other' END,
      CASE WHEN i%2=0 THEN 'buyer-context' ELSE 'other-context' END,
      'session-'||i,'1','address-'||i,'individual','DDP','USD',100,0,'scale-'||i,
      '{"lines":[{"lineKind":"standard"}]}','2026-09-24T12:00:00.000Z' FROM n`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO quote_conversations(request_id,created_at)
    SELECT id,'2026-09-25T00:00:00.000Z' FROM customer_quote_requests
    WHERE id LIKE 'scale-%' AND CAST(substr(id,7) AS INTEGER)<=180 AND CAST(substr(id,7) AS INTEGER)%9!=0`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO message_internal_notes(id,request_id,admin_id,body,created_at,command_id,command_hash)
    SELECT id||'-note',id,'owner-1','Private','2026-09-25T13:00:00.000Z',id||'-note','fixture'
    FROM customer_quote_requests WHERE id LIKE 'scale-%' AND CAST(substr(id,7) AS INTEGER)<=180 AND CAST(substr(id,7) AS INTEGER)%9=0`,
    )
    .run();
  await history(1, 8);
}, 180000);
afterAll(async () => {
  if (process.env.D1_READ_COST_REPORT)
    writeFileSync(
      process.env.D1_READ_COST_REPORT,
      JSON.stringify(
        {
          environment: "local workerd/D1; synthetic data; core reads only",
          bulkHoseSkus: BULK,
          quoteRequests: 1000,
          conversations: 180,
          messageConversations: 160,
          noteOnlyConversations: 20,
          messages: 16000,
          rowsRead: measurements,
        },
        null,
        2,
      ) + "\n",
    );
  clearPublicCatalogCache();
  await dispose?.();
});

it("bounds catalog, editor, configurator and quote-list core reads at larger volume", async () => {
  const catalog = await measure("catalog_cold", (binding) =>
    createD1PublicCatalogRepository(binding).browse({}),
  );
  expect(catalog.items.length).toBeGreaterThan(BULK);
  expect(measurements.catalog_cold).toBeLessThan(40 * BULK + 10000);
  const warm = metered(db);
  clearPublicCatalogCache();
  await createD1PublicCatalogRepository(warm.binding, {
    sharedCache: true,
  }).browse({});
  warm.counter.reads = 0;
  expect(
    (
      await createD1PublicCatalogRepository(warm.binding, {
        sharedCache: true,
      }).browse({})
    ).items,
  ).toEqual(catalog.items);
  measurements.catalog_warm = warm.counter.reads;
  expect(measurements.catalog_warm).toBeLessThan(10);
  const category = await measure("catalog_fittings", (binding) =>
    createD1PublicCatalogRepository(binding).browse({ category: "hose-ends" }),
  );
  expect(category.items.length).toBeGreaterThan(0);
  expect(measurements.catalog_fittings).toBeLessThan(
    measurements.catalog_cold / 2,
  );
  const input = { types: [], query: "", page: 1, pageSize: 20 as const };
  await measure("products_all", (binding) =>
    createD1ProductManagementRepository(binding).list(input),
  );
  await measure("products_fittings", (binding) =>
    createD1ProductManagementRepository(binding).list({
      ...input,
      types: ["hose_end"],
    }),
  );
  await measure("editor_hose", (binding) =>
    createD1ProductManagementRepository(binding).editorOptions("hose"),
  );
  await measure("product_single", (binding) =>
    createD1ProductManagementRepository(binding).findSku("601R1_B1500", "hose"),
  );
  expect(measurements.products_all).toBeLessThan(50 * BULK + 10000);
  for (const name of ["products_fittings", "editor_hose", "product_single"])
    expect(measurements[name]).toBeLessThan(measurements.products_all);
  const ends = await measure("configurator_end_a", (binding) =>
    createD1ConfiguratorRepository(binding).findCompatibleEndA(
      "active-release",
      "601R1_001",
    ),
  );
  expect(ends.length).toBeGreaterThan(0);
  expect(measurements.configurator_end_a).toBeLessThan(30 * BULK + 10000);
  const filters = {
    reviewState: "all",
    technicalReview: "all",
    sort: "newest",
  } as const;
  const full = await measure("quotes_all", (binding) =>
    createD1AdminQuoteReviewRepository(binding).list(filters),
  );
  const page = await measure("quotes_page", (binding) =>
    createD1AdminQuoteReviewRepository(binding).listPage(filters),
  );
  expect(full).toHaveLength(1000);
  expect(page.reviews).toEqual(full.slice(0, 25));
  expect(measurements.quotes_page).toBeLessThan(measurements.quotes_all);
  expect(measurements.quotes_page).toBeLessThan(20000);
}, 120000);

it("keeps admin inbox results exact at 16000 messages and avoids full-history sorting", async () => {
  const options = { filter: "all" as const, query: "", page: 1 };
  await measure("inbox_1280", (binding) =>
    createD1MessageCenter(binding).adminThreads("owner-1", options),
  );
  await history(9, 100);
  await db
    .prepare(
      `INSERT INTO message_reads(message_id,reader_role,reader_id)
    SELECT id,'admin','owner-1' FROM quote_conversation_messages WHERE request_id='scale-0001'`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO quote_conversation_attachments(message_id,filename,content_type,byte_size,checksum,object_key)
    VALUES ('scale-0179-message-0100','part.png','image/png',10,'fixture','scale-image')`,
    )
    .run();
  const customer = await measure("customer_inbox_16000", (binding) =>
    createD1MessageCenter(binding).customerThreads("buyer", 1),
  );
  expect(customer.threads).toHaveLength(30);
  expect(
    customer.threads.every(
      (thread) => Number(thread.requestId.slice(6)) % 2 === 0,
    ),
  ).toBe(true);
  expect(measurements.customer_inbox_16000).toBeLessThan(60000);
  const result = await measure("inbox_16000", (binding) =>
    createD1MessageCenter(binding).adminThreads("owner-1", options),
  );
  const reference = await measure("inbox_legacy_16000", (binding) =>
    legacyAdminThreads(binding, "owner-1", options),
  );
  expect(result).toEqual(reference);
  expect(measurements.inbox_legacy_16000).toBeGreaterThan(
    measurements.inbox_16000 * 3,
  );
  expect(measurements.inbox_16000).toBeLessThan(16000);
  for (const reader of ["owner-1", "reviewer-1"]) {
    for (const filter of ["all", "unread", "awaiting"] as const) {
      for (const page of [1, 2, 5, 7]) {
        const options = { filter, query: "", page };
        expect(
          await createD1MessageCenter(db).adminThreads(reader, options),
        ).toEqual(await legacyAdminThreads(db, reader, options));
      }
    }
    const count = await measure(`unread_${reader}`, (binding) =>
      createD1MessageCenter(binding).adminUnreadThreads(reader),
    );
    const old = await measure(`unread_legacy_${reader}`, (binding) =>
      binding
        .prepare(
          `SELECT count(DISTINCT m.request_id) AS count FROM quote_conversation_messages m
      WHERE m.author_role='customer' AND NOT EXISTS (SELECT 1 FROM message_reads r
      WHERE r.message_id=m.id AND r.reader_role='admin' AND r.reader_id=?)`,
        )
        .bind(reader)
        .first<number>("count"),
    );
    expect(count).toBe(old);
    expect(measurements[`unread_${reader}`]).toBeLessThan(
      measurements[`unread_legacy_${reader}`],
    );
  }
  const search = { filter: "all" as const, query: "QR-SCALE-0001", page: 1 };
  expect(
    await measure("inbox_search", (binding) =>
      createD1MessageCenter(binding).adminThreads("owner-1", search),
    ),
  ).toEqual(await legacyAdminThreads(db, "owner-1", search));
}, 120000);
