import { seedCatalogItemBaseline } from "./catalog-item-baseline";
import { componentImportFixtures } from "./component-item-import";
import { createD1CatalogItemRepository } from "../../app/modules/catalog/infrastructure/d1-catalog-item-repository";
import { createD1ItemImportReview } from "../../app/modules/catalog/infrastructure/d1-item-import-review";

export async function seedManagedAssemblyBaseline(db: D1Database) {
  await seedCatalogItemBaseline(db);
  const items = createD1CatalogItemRepository(db);
  await items.enable({ environment: "local", actorId: "owner-1" });
  const payload = (await items.findPayload("sku", "601R1_001"))!;
  if (payload.kind === "sku") payload.variant.notes = "Reviewed baseline";
  await items.apply({
    payload,
    targetState: "online",
    mode: "edit",
    commandId: crypto.randomUUID(),
    actorId: "owner-1",
    ipAddress: "local",
    baselineRevisionId: null,
    source: { channel: "manual" },
  });
  const review = createD1ItemImportReview(db, {
    id: "owner-1",
    catalogPermission: "edit",
  });
  for (const f of componentImportFixtures.slice(0, 2)) {
    const master = Object.fromEntries(
      Object.entries({
        ...f.variant,
        ...(f.type === "ferrule" ? { skiveRequirement: "No Skive" } : {}),
        seriesName: f.series,
        seriesMediaVersionId: "uploaded-v2",
        ...(f.type === "hose_end"
          ? {
              angle: "0° Straight",
              gender: "Female",
              interfaceFamily: "JIC 37°",
              connectionStandard: "SAE J514",
              sealingForm: "37° flare",
              swivelForm: "Swivel",
            }
          : {}),
      }).filter(([, v]) => v !== null),
    );
    const price = {
      productType: f.type === "hose_end" ? "Hose End" : "Ferrule",
      baseSku: f.code,
      amount: 15,
      currency: "USD",
      salesUnit: "each",
      quantityInputMode: "Units",
      moq: 1,
      leadTimeDays: 10,
      countryOfOrigin: "China",
    };
    const batchId = crypto.randomUUID();
    await review.importWorkbook({
      batchId,
      fileName: "components.xlsx",
      fileSize: 100,
      actorId: "owner-1",
      ipAddress: "local",
      sheets: [
        {
          sheet: f.type === "hose_end" ? "02_压接接头" : "03_套筒",
          data: [Object.keys(master), Object.values(master)],
        },
        {
          sheet: "07_价格包装",
          data: [Object.keys(price), Object.values(price)],
        },
      ],
    });
    const rows = (await review.all()).filter((r) => r.batchId === batchId);
    const results = await review.review({
      selected: rows.map((r) => ({ id: r.id, version: r.version })),
      intent: "approve",
      actorId: "owner-1",
      ipAddress: "local",
    });
    if (results.some((r) => !r.ok)) throw Error(JSON.stringify(results));
  }
}
