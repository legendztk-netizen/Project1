import { createD1AnonymousQuoteListRepository } from "../app/modules/quote-list/infrastructure/d1-anonymous-quote-list-repository";
import { calculateLengthBasedHoseEstimate } from "../app/modules/quote-list/domain/length-based-hose";
import { seedCatalogItemBaseline } from "./fixtures/catalog-item-baseline";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformProxy } from "wrangler";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { action } from "../app/modules/admin/routes/catalog-items";
import { createD1CatalogItemRepository } from "../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1PublicCatalogRepository } from "../app/modules/catalog/infrastructure/d1-public-catalog-repository";
import { captureQuoteRequestProductSnapshot } from "../app/modules/quote-request/domain/quote-request";
import type { CatalogItemCommand } from "../app/modules/catalog/domain/catalog-item-publication";

const root = join(import.meta.dirname, "..");
const directory = mkdtempSync(join(tmpdir(), "catalog-items-d1-"));
let platform: Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>;
let database: D1Database;
let repository: ReturnType<typeof createD1CatalogItemRepository>;
let catalog: ReturnType<typeof createD1PublicCatalogRepository>;
beforeAll(async () => {
  const migration = spawnSync("pnpm", ["migrate"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, D1_PERSIST_TO: directory },
  });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: join(root, "wrangler.jsonc"),
    persist: { path: join(directory, "v3") },
    remoteBindings: false,
  });
  database = platform.env.DB;
  await seedCatalogItemBaseline(database);

  repository = createD1CatalogItemRepository(
    database,
    () => new Date("2026-09-08T00:00:00Z"),
  );
  catalog = createD1PublicCatalogRepository(database);
}, 60000);
afterAll(async () => {
  await platform?.dispose();
  rmSync(directory, { force: true, recursive: true });
});

async function command(
  amount: number,
  currency = "USD",
): Promise<CatalogItemCommand> {
  const payload = await repository.findPayload("sku", "601R1_001");
  if (!payload || payload.kind !== "sku") throw new Error("Fixture missing");
  payload.variant.notes = "Reviewed Hose";
  payload.price = { ...payload.price, amount, currency, packageLengthFt: null };
  return {
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    payload,
    targetState: "online",
    mode: "edit",
    baselineRevisionId: null,
    source: { channel: "manual" },
  };
}

describe("D1 item publication", () => {
  it("isolates activation and retains the legacy baseline", async () => {
    expect((await repository.state()).mode).toBe("legacy");
    await expect(
      repository.enable({ environment: "production", actorId: "owner-1" }),
    ).rejects.toThrow("Ticket 05");
    await repository.enable({ environment: "local", actorId: "owner-1" });
    expect((await catalog.findItem("601R1_001"))?.offer?.referencePrice).toBe(
      3.25,
    );
  });
  it("publishes B, then older request A, and replaying A cannot overwrite C", async () => {
    const pending = await repository.createRequest(await command(10), {
      row: "A",
    });
    const b = await repository.apply(await command(20));
    expect((await catalog.findItem("601R1_001"))?.offer?.referencePrice).toBe(
      20,
    );
    const a = await repository.approveRequest(pending, "owner-1", "local");
    expect(a.sequence).toBeGreaterThan(b.sequence);
    expect((await catalog.findItem("601R1_001"))?.offer?.referencePrice).toBe(
      10,
    );
    const c = await repository.apply(await command(30));
    expect(
      await repository.approveRequest(pending, "owner-2", "203.0.113.8"),
    ).toEqual(a);
    expect(
      (await catalog.findItem("601R1_001"))?.catalogBasis?.skuRevisionId,
    ).toBe(c.revisionId);
    expect(
      (
        await database
          .prepare(
            "SELECT reference_price_usd FROM catalog_sales_offers WHERE id='active-offer'",
          )
          .first<{ reference_price_usd: number }>()
      )?.reference_price_usd,
    ).toBe(3.25);
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM catalog_releases")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    expect(
      (
        await database
          .prepare("SELECT count(*) AS n FROM catalog_item_assembly_state")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("retains non-USD prices and immutable price/media/rule snapshot", async () => {
    const input = await command(88, "CNY");
    const published = await repository.apply(input);
    const product = (await catalog.findItem("601R1_001"))!;
    expect(product.offer).toMatchObject({
      referencePrice: 88,
      currency: "CNY",
    });
    const snapshot = captureQuoteRequestProductSnapshot(product);
    await repository.apply(await command(40));
    expect(snapshot.offer).toMatchObject({
      referencePrice: 88,
      currency: "CNY",
    });
    expect(snapshot.catalogBasis?.skuRevisionId).toBe(published.revisionId);
    expect(
      (await repository.history("sku", "601R1_001")).find(
        (r) => r.revisionId === published.revisionId,
      )?.payload,
    ).toMatchObject({ price: { amount: 88, currency: "CNY" } });
    await expect(
      database
        .prepare(
          "UPDATE catalog_product_revisions SET actor_id='other' WHERE id=?",
        )
        .bind(published.revisionId)
        .run(),
    ).rejects.toThrow("immutable");
  });
  it("saves drafts separately, rejects invalid data atomically and invalidates Dash changes", async () => {
    const live = (await catalog.findItem("601R1_001"))!;
    const draft = await command(50);
    draft.targetState = "draft";
    await repository.apply(draft);
    expect(
      (await catalog.findItem("601R1_001"))?.catalogBasis?.skuRevisionId,
    ).toBe(live.catalogBasis?.skuRevisionId);
    const invalid = await command(-1);
    const state = await repository.state();
    await expect(repository.apply(invalid)).rejects.toThrow();
    expect(await repository.state()).toEqual(state);
    const dash = await command(40);
    if (dash.payload.kind === "sku" && dash.payload.productType === "hose")
      dash.payload.variant.dash = "-6";
    const changed = await repository.apply(dash);
    expect(
      (
        await database
          .prepare(
            "SELECT invalidated_sequence FROM catalog_item_assembly_state WHERE hose_series='601R1'",
          )
          .first<{ invalidated_sequence: number }>()
      )?.invalidated_sequence,
    ).toBe(changed.sequence);
    expect(
      (
        await database
          .prepare("SELECT sku FROM catalog_item_unavailable_hoses")
          .all()
      ).results,
    ).toContainEqual({ sku: "601R1_001" });
    const stop = await command(40);
    stop.targetState = "discontinued";
    await repository.apply(stop);
    expect(await catalog.findItem("601R1_001")).toBeNull();
  });
  it("rolls back pointer, revision and invalidation if audit append fails", async () => {
    const before = await repository.state();
    await database
      .prepare(
        `CREATE TRIGGER test_audit_failure BEFORE INSERT ON admin_audit_events WHEN NEW.event_type='catalog_item.applied' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END`,
      )
      .run();
    try {
      await expect(repository.apply(await command(60))).rejects.toThrow(
        "injected audit failure",
      );
    } finally {
      await database.prepare("DROP TRIGGER test_audit_failure").run();
    }
    expect(await repository.state()).toEqual(before);
  });
  it("serializes concurrent successful commands even at identical timestamps", async () => {
    const a = await command(71);
    const b = await command(72);
    const results = await Promise.all([
      repository.apply(a),
      repository.apply(b),
    ]);
    const winner =
      results[0].sequence > results[1].sequence ? results[0] : results[1];
    expect(
      (await catalog.findItem("601R1_001"))?.catalogBasis?.skuRevisionId,
    ).toBe(winner.revisionId);
    expect(new Set(results.map((r) => r.sequence)).size).toBe(2);
  });
  it("publishes only the selected new SKU and keeps inherited attributes on its series", async () => {
    const first = await command(73);
    first.mode = "create";
    if (first.payload.kind === "sku") first.payload.variant.sku = "601R1_NEW";
    const pending = structuredClone(first);
    pending.commandId = crypto.randomUUID();
    if (pending.payload.kind === "sku")
      pending.payload.variant.sku = "601R1_PENDING";
    await repository.createRequest(pending, { row: "pending" });
    await repository.apply(first);
    expect(await catalog.findItem("601R1_PENDING")).toBeNull();
    const series = await repository.findPayload("series", "601R1");
    if (!series || series.kind !== "series") throw new Error("series missing");
    series.series.tempMaxC = 120;
    await repository.apply({
      ...first,
      commandId: crypto.randomUUID(),
      mode: "edit",
      payload: series,
    });
    const product = (await catalog.findItem("601R1_NEW"))!;
    expect(product.variantSelection).toMatchObject({
      performance: { temperatureMaxC: 120 },
    });
    expect(product.offer?.referencePrice).toBe(73);
    expect(
      (await repository.history("sku", "601R1_NEW"))[0].payload,
    ).not.toHaveProperty("series");
  });
  it("supports a new draft identity becoming live without a second entity", async () => {
    const draft = await command(74);
    draft.mode = "create";
    draft.targetState = "draft";
    if (draft.payload.kind === "sku") draft.payload.variant.sku = "601R1_DRAFT";
    await repository.apply(draft);
    expect(await catalog.findItem("601R1_DRAFT")).toBeNull();
    await repository.apply({
      ...draft,
      commandId: crypto.randomUUID(),
      mode: "edit",
      targetState: "online",
    });
    expect((await catalog.findItem("601R1_DRAFT"))?.offer?.referencePrice).toBe(
      74,
    );
  });
  it("rejects a stale quote write and preserves the already saved amount", async () => {
    const quotes = createD1AnonymousQuoteListRepository(database);
    const now = "2026-09-08T00:00:00Z",
      expiresAt = "2026-10-08T00:00:00Z";
    await quotes.createSession({ id: "item-session", expiresAt }, now);
    const product = (await catalog.findItem("601R1_001"))!;
    const order = {
      normalizedLengthFt: 10,
      originalLengthValue: 10,
      originalLengthUnit: "ft" as const,
      pieceCount: 1,
      totalFootage: 10,
    };
    const estimate = calculateLengthBasedHoseEstimate({
      feeRatePerPiece:
        product.offer!.lengthOrdering!.cuttingLabelingFee.ratePerPiece,
      order,
      referencePricePerFoot: product.offer!.referencePrice,
    });
    const input = {
      estimate,
      expiresAt,
      lineId: "item-line",
      now,
      order,
      product,
      sessionId: "item-session",
    };
    expect(await quotes.addLengthBasedHoseLine(input)).toBe("item-line");
    const before = await quotes.listLines("item-session");
    await repository.apply(await command(99));
    expect(
      await quotes.addLengthBasedHoseLine({ ...input, lineId: "stale-line" }),
    ).toBeNull();
    expect(await quotes.listLines("item-session")).toEqual(before);
  });
  it("rejects incomplete series length rules without changing live children", async () => {
    const series = await repository.findPayload("series", "601R1");
    if (series?.kind !== "series" || !series.commercialRule)
      throw new Error("series missing");
    series.commercialRule.lengthIncrementFt = null;
    const before = await repository.state();
    await expect(
      repository.apply({ ...(await command(99)), payload: series }),
    ).rejects.toThrow("Length ordering");
    expect(await repository.state()).toEqual(before);
  });
  it("keeps a request pending when its series dependency is not approved", async () => {
    const id = await repository.createRequest(
      await command(101),
      { row: "dependent" },
      ["missing-parent"],
    );
    const before = await repository.state();
    await expect(
      repository.approveRequest(id, "owner-1", "local"),
    ).rejects.toThrow("dependency");
    expect(await repository.state()).toEqual(before);
    expect(
      await database
        .prepare(
          "SELECT status FROM catalog_product_change_requests WHERE id = ?",
        )
        .bind(id)
        .first(),
    ).toEqual({ status: "pending" });
  });
  it("rejects old publication and unauthenticated form actions", async () => {
    await expect(
      database
        .prepare("UPDATE catalog_active_release SET version=version+1")
        .run(),
    ).rejects.toThrow("disabled");
    const context = new RouterContextProvider();
    context.set(cloudflareContext, {
      env: { DB: database, APP_ENV: "local" } as CloudflareBindings,
      runtime: { environment: "local" },
      ctx: {} as ExecutionContext,
    });
    await expect(
      action({
        context,
        request: new Request("http://admin.localhost/admin/catalog/items", {
          method: "POST",
        }),
        params: {},
        url: new URL("http://admin.localhost/admin/catalog/items"),
        pattern: "/admin/catalog/items",
      } as Parameters<typeof action>[0]),
    ).rejects.toMatchObject({ status: 403 });
  });
});
