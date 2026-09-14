import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createQuotePreparation } from "../app/modules/quote-review/infrastructure/d1-quote-preparation";
import { createD1QuoteRequestRepository } from "../app/modules/quote-request/infrastructure/d1-quote-request-repository";
import type { AdminIdentity } from "../workers/admin-access";
import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { loader as pricingLoader } from "../app/modules/admin/routes/quote-pricing";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";

const directory = mkdtempSync(join(tmpdir(), "quote-preparation-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let db: D1Database;
const actor: AdminIdentity = {
  id: "local-owner",
  email: "owner@local.invalid",
  accountType: "owner",
  canManageSubaccounts: true,
  source: "local-development",
};
const source = {
  version: 2,
  lines: [
    {
      lineKind: "standard",
      sku: "601R1_001",
      catalogReleaseId: "active-release",
      salesUnit: "roll",
      productSnapshot: {
        catalogBasis: {
          skuRevisionId: "captured-sku-v1",
          seriesRevisionId: "captured-series-v1",
        },
        mainImageUrl: "/media/catalog/captured-v1/storefront",
      },
      quantity: 2,
      currency: "CNY",
      referenceUnitPrice: 50,
    },
    {
      lineKind: "length_based_hose",
      sku: "fixture-length",
      catalogReleaseId: "active-release",
      salesUnit: "ft",
      quantity: 3,
      currency: "USD",
      referenceUnitPrice: 2,
      lengthOrder: { totalFootage: 2.5 },
    },
    {
      lineKind: "configured_assembly",
      sku: "fixture-assembly",
      catalogReleaseId: "active-release",
      salesUnit: "EA",
      quantity: 4,
      currency: "USD",
      referenceUnitPrice: 70,
    },
  ],
};
beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: "wrangler.jsonc",
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  db = platform.env.DB;
  await seedCatalogItemBaseline(db, 987654.32);
  await db.batch([
    db.prepare(
      "INSERT INTO customer_profiles(id,email_normalized,email_display,email_verified_at,created_at,updated_at) VALUES('pricing-profile','pricing@example.com','pricing@example.com','2026-09-14','2026-09-14','2026-09-14')",
    ),
    db.prepare(
      "INSERT INTO customer_purchasing_contexts(id,kind,individual_profile_id,created_at,updated_at) VALUES('pricing-context','individual','pricing-profile','2026-09-14','2026-09-14')",
    ),
    db
      .prepare(
        "INSERT INTO customer_quote_requests(id,reference_number,profile_id,purchasing_context_id,source_session_id,source_session_version,source_address_id,purchasing_context_kind,fulfillment_term,currency,merchandise_subtotal,service_fee_total,idempotency_key,snapshot_json,submitted_at) VALUES('pricing-rfq','QR-PRICING','pricing-profile','pricing-context','session','1','address','individual','DDP','USD',0,0,'pricing-request',?,'2026-09-14')",
      )
      .bind(JSON.stringify(source)),
  ]);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { recursive: true, force: true });
});

it("starts one draft with exact source context and no inferred USD prices", async () => {
  const service = createQuotePreparation(db, actor);
  const [first, second] = await Promise.all([
    service.start("pricing-rfq"),
    service.start("pricing-rfq"),
  ]);
  expect(first).toEqual(second);
  expect(first.source).toEqual(source);
  expect(first.prices.every((price) => price.unitPriceCents === null)).toBe(
    true,
  );
  await expect(
    db
      .prepare("UPDATE quote_preparation_drafts SET source_snapshot_json='{}'")
      .run(),
  ).rejects.toThrow(/immutable/);
});

it("audits exact previous/new USD prices, rejects stale writes and replays commands", async () => {
  const service = createQuotePreparation(db, actor);
  const prices = [1000, 200, 7000].map((unitPriceCents) => ({
    unitPriceCents,
    discountBasisPoints: 1000,
  }));
  const commandId = crypto.randomUUID();
  expect(
    await service.savePrices(
      "pricing-rfq",
      1,
      prices,
      "reviewed USD offer",
      commandId,
    ),
  ).toBe(2);
  expect(
    await service.savePrices(
      "pricing-rfq",
      1,
      prices,
      "reviewed USD offer",
      commandId,
    ),
  ).toBe(2);
  await expect(
    service.savePrices("pricing-rfq", 1, prices, "stale", crypto.randomUUID()),
  ).rejects.toMatchObject({ status: 409 });
  const audit = await db
    .prepare("SELECT actor_id,payload_json FROM admin_audit_events WHERE id=?")
    .bind(`quote-pricing:${commandId}`)
    .first<{ actor_id: string; payload_json: string }>();
  expect(audit?.actor_id).toBe(actor.id);
  expect(JSON.parse(audit!.payload_json)).toMatchObject({
    currency: "USD",
    former: [
      { unitPriceCents: null },
      { unitPriceCents: null },
      { unitPriceCents: null },
    ],
    current: prices,
    reason: "reviewed USD offer",
    version: 2,
  });
  const results = await Promise.allSettled([
    service.savePrices("pricing-rfq", 2, prices, "race-a", crypto.randomUUID()),
    service.savePrices("pricing-rfq", 2, prices, "race-b", crypto.randomUUID()),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect((await service.find("pricing-rfq"))?.version).toBe(3);
  const customer = await createD1QuoteRequestRepository(db).findOwned(
    "pricing-profile",
    "pricing-rfq",
  );
  expect(customer?.snapshot).toEqual(source);
  expect(JSON.stringify(customer)).not.toContain("reviewed USD offer");
});

it("exposes legacy cost only in authorized Admin projection, preserving item/image source evidence", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    adminIdentity: actor,
    env: platform.env as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  const url = new URL(
    "http://admin.localhost/admin/quotes/pricing-rfq/pricing",
  );
  const args = {
    context,
    url,
    request: new Request(url),
    params: { requestId: "pricing-rfq" },
    pattern: "/admin/quotes/:requestId/pricing",
  };
  const admin = await pricingLoader(args);
  expect(admin.data.costs[0][0].factory_unit_price).toBe(987654.32);
  const saved = await createQuotePreparation(db, actor).find("pricing-rfq");
  expect(saved?.source).toEqual(source);
  const customer = JSON.stringify(
    await createD1QuoteRequestRepository(db).findOwned(
      "pricing-profile",
      "pricing-rfq",
    ),
  );
  const audit = JSON.stringify(
    (
      await db
        .prepare(
          "SELECT payload_json FROM admin_audit_events WHERE entity_type='quote_preparation'",
        )
        .all()
    ).results,
  );
  for (const content of [customer, audit, JSON.stringify(saved)]) {
    expect(content).not.toContain("987654.32");
    expect(content).not.toContain("factory_unit_price");
  }
  context.set(cloudflareContext, {
    env: platform.env as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  await expect(pricingLoader(args)).rejects.toMatchObject({ status: 403 });
  const catalog = createD1CatalogItemRepository(db);
  await catalog.enable({ environment: "local", actorId: actor.id });
  const series = (await catalog.findPayload("series", "601R1"))!;
  if (series.kind !== "series") throw new Error("Expected series fixture");
  series.series.seriesName = "Changed after RFQ";
  series.mediaVersionId = "uploaded-v2";
  await catalog.apply({
    payload: series,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: actor.id,
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  expect(
    (await createQuotePreparation(db, actor).start("pricing-rfq"))?.source,
  ).toEqual(source);
  expect(
    (await createQuotePreparation(db, actor).find("pricing-rfq"))?.prices,
  ).toEqual(saved?.prices);
});
