import {
  CatalogItemRejected,
  normalizeItemPrice,
  type AdditionalCatalogItemPayload,
  type CatalogItemCommand,
  type CatalogItemPayload,
  type ItemPrice,
} from "../domain/catalog-item-publication";
import {
  normalizeSeriesCommercialRule,
  type CommercialProductType,
  type SeriesCommercialRule,
} from "../domain/catalog-commercial-maintenance";
import {
  validateHoseEndSeriesMaintenance,
  validateHoseEndVariantMaintenance,
  type HoseEndSeriesRecord,
} from "../domain/catalog-hose-end-maintenance";
import { validateItemComponent } from "../domain/catalog-manual-component";
import { validateProductPackaging } from "../domain/catalog-product-management";
import { type CatalogWorkbookCell } from "../domain/catalog-workbook";
import { productLifecycleState } from "../domain/catalog-product-lifecycle";

export const productItemTables = {
  hose: "catalog_runtime_hose_variants",
  hose_end: "catalog_runtime_hose_ends",
  ferrule: "catalog_runtime_ferrules",
  adapter: "catalog_runtime_adapters",
  quick_coupler: "catalog_runtime_quick_couplers",
} as const;
export const productSeriesKeys = {
  hose: "hoseSeries",
  hose_end: "fittingSeries",
  ferrule: "ferruleSeries",
  adapter: "adapterFamilyId",
  quick_coupler: "couplerSeries",
} as const;
export function itemSeriesCode(payload: CatalogItemPayload): string {
  if (payload.kind === "series") return payload.series.seriesCode;
  return String(
    (payload.variant as unknown as Record<string, unknown>)[
      productSeriesKeys[payload.productType]
    ] ?? "",
  );
}
export function camelDatabaseRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
}
const endOwned = [
  "coating",
  "competitorPartNumber",
  "connectionDash",
  "cutoffBMm",
  "dimensionAMm",
  "drawingNumber",
  "drawingRevision",
  "fittingSeries",
  "hex1Mm",
  "hex2Mm",
  "hoseTailDash",
  "material",
  "maxWorkingBar",
  "minimumBoreMm",
  "notes",
  "saltSprayHours",
  "sku",
  "source",
  "technicalDataStatus",
  "thread",
  "unitWeightG",
];
export function createD1AdditionalCatalogItems(database: D1Database) {
  const active =
    " JOIN catalog_releases r ON r.source_import_id = m.import_id JOIN catalog_active_release a ON a.release_id=r.id ";
  async function reference(id: string | null) {
    if (!id) return "";
    const image = await database
      .prepare(
        "SELECT approved_reference FROM catalog_media_versions WHERE id=?",
      )
      .bind(id)
      .first<{ approved_reference: string | null }>();
    if (!image)
      throw new CatalogItemRejected("Image version not found / 图片版本不存在");
    return image.approved_reference ?? `media-version:${id}`;
  }
  async function read(
    type: Exclude<CommercialProductType, "hose">,
    kind: "series" | "sku",
    code: string,
    draft = false,
  ): Promise<AdditionalCatalogItemPayload | null> {
    const revision = await database
      .prepare(
        `SELECT r.payload_json FROM catalog_product_entities e JOIN catalog_product_revisions r ON r.id=CASE WHEN ? THEN COALESCE(e.draft_revision_id,e.current_revision_id) ELSE e.current_revision_id END WHERE e.product_type=? AND e.kind=? AND e.code=?`,
      )
      .bind(draft ? 1 : 0, type, kind, code)
      .first<{ payload_json: string }>();
    if (revision)
      return JSON.parse(revision.payload_json) as AdditionalCatalogItemPayload;
    if (kind === "series") {
      const ruleRow = await database
        .prepare(
          `SELECT m.* FROM catalog_runtime_series_commercial_rules m ${active} WHERE m.product_type=? AND m.series_code=?`,
        )
        .bind(type, code)
        .first<Record<string, unknown>>();
      const commercialRule = ruleRow
        ? (camelDatabaseRow(ruleRow) as unknown as SeriesCommercialRule)
        : null;
      if (type === "hose_end") {
        const row = await database
          .prepare(
            `SELECT m.* FROM catalog_runtime_hose_end_series m ${active} WHERE m.series_code=?`,
          )
          .bind(code)
          .first<Record<string, unknown>>();
        if (!row) return null;
        const mediaVersionId = row.representative_media_version_id as
          string | null;
        return {
          kind,
          productType: type,
          series: {
            ...camelDatabaseRow(row),
            interfaceStandard: row.connection_standard,
            representativeImageReference: await reference(mediaVersionId),
          } as unknown as HoseEndSeriesRecord,
          commercialRule,
          mediaVersionId,
        };
      }
      const column = productSeriesKeys[type].replace(
        /[A-Z]/g,
        (c) => "_" + c.toLowerCase(),
      );
      const exists = await database
        .prepare(
          `SELECT m.sku FROM ${productItemTables[type]} m ${active} WHERE m.${column}=? LIMIT 1`,
        )
        .bind(code)
        .first();
      const draftChild = await database
        .prepare(
          `SELECT 1 AS found FROM catalog_product_entities e JOIN catalog_product_revisions r ON r.id=e.draft_revision_id WHERE e.product_type=? AND e.kind='sku' AND e.hidden_at IS NULL AND json_extract(r.payload_json,?)=? LIMIT 1`,
        )
        .bind(type, "$.variant." + productSeriesKeys[type], code)
        .first();
      if (!ruleRow && !exists && !draftChild) return null;
      return {
        kind,
        productType: type,
        series: { seriesCode: code, seriesName: code },
        commercialRule,
        mediaVersionId: null,
      };
    }
    const row = await database
      .prepare(
        `SELECT m.*,s.technical_data_status FROM ${productItemTables[type]} m ${active} JOIN catalog_runtime_skus s ON s.import_id=m.import_id AND s.sku=m.sku WHERE m.sku=?`,
      )
      .bind(code)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const [exact, offer, image] = await database.batch<Record<string, unknown>>(
      [
        database
          .prepare(
            `SELECT m.* FROM catalog_runtime_sku_price_packaging m ${active} WHERE m.sku=?`,
          )
          .bind(code),
        database
          .prepare(
            `SELECT m.* FROM catalog_runtime_sales_offers m ${active} WHERE m.base_sku=?`,
          )
          .bind(code),
        database
          .prepare(
            `SELECT m.media_version_id FROM catalog_runtime_product_main_images m ${active} WHERE m.sku=? AND m.assignment_kind='override'`,
          )
          .bind(code),
      ],
    );
    const priceRow = exact.results[0] ?? offer.results[0];
    const price = priceRow
      ? ({
          ...camelDatabaseRow(priceRow),
          amount: priceRow.reference_price_usd,
          currency: priceRow.currency ?? "USD",
          packageLengthFt: priceRow.package_length_ft ?? null,
        } as unknown as ItemPrice)
      : null;
    const data = camelDatabaseRow(row);
    const variant =
      type === "hose_end"
        ? Object.fromEntries(endOwned.map((k) => [k, data[k]]))
        : Object.fromEntries(
            Object.entries(data).filter(
              ([k]) => !["id", "importId"].includes(k),
            ),
          );
    return {
      kind,
      productType: type,
      variant,
      price,
      mediaVersionId: (image.results[0]?.media_version_id ?? null) as
        string | null,
    } as unknown as AdditionalCatalogItemPayload;
  }
  async function validate(input: CatalogItemCommand, fromRequest: boolean) {
    if (input.payload.productType === "hose")
      throw new CatalogItemRejected("Unsupported handler");
    const payload = structuredClone(input.payload),
      type = payload.productType;
    const code =
      payload.kind === "series"
        ? payload.series.seriesCode
        : payload.variant.sku;
    const entity = await database
      .prepare(
        "SELECT kind,product_type,hidden_at FROM catalog_product_entities WHERE code=? AND (kind='sku' OR (kind=? AND product_type=?))",
      )
      .bind(code, payload.kind, type)
      .first<{
        kind: string;
        product_type: string;
        hidden_at: string | null;
      }>();
    const legacy = await read(type, payload.kind, code, true);
    const skuIdentity =
      payload.kind === "sku"
        ? await database
            .prepare(
              `SELECT s.product_type FROM catalog_runtime_skus s JOIN catalog_releases r ON r.source_import_id=s.import_id JOIN catalog_active_release a ON a.release_id=r.id WHERE s.sku=?`,
            )
            .bind(code)
            .first<{ product_type: string }>()
        : null;
    if (entity?.hidden_at)
      throw new CatalogItemRejected(
        "Deleted identity cannot be reused / 已删除编号不能复用",
        409,
      );
    if (
      (entity && entity.product_type !== type) ||
      (skuIdentity && skuIdentity.product_type !== type)
    )
      throw new CatalogItemRejected(
        "SKU belongs to another type / SKU 属于其他产品类目",
        409,
      );
    const exists = Boolean(entity || legacy);
    if (!exists && !/^[A-Z0-9_-]+$/.test(code))
      throw new CatalogItemRejected("Invalid immutable code / 产品编号无效");
    if (input.mode === "create" && exists && !fromRequest)
      throw new CatalogItemRejected(
        "Product already exists / 产品编号已存在",
        409,
      );
    if (input.mode === "edit" && !exists)
      throw new CatalogItemRejected("Product not found / 产品不存在", 404);
    const mode = fromRequest && exists ? "edit" : input.mode;
    const imageReference = await reference(payload.mediaVersionId);
    const findSeries = async (value: string) => {
      const originalCode =
        payload.kind === "sku" && payload.productType === "hose_end"
          ? payload.variant.fittingSeries
          : value;
      const p = await read(
        "hose_end",
        "series",
        originalCode.toUpperCase() === value.toUpperCase()
          ? originalCode
          : value,
      );
      return p?.kind === "series" && p.productType === "hose_end"
        ? p.series
        : null;
    };
    if (payload.kind === "series") {
      if (input.targetState === "discontinued")
        throw new CatalogItemRejected("Use series deletion / 请使用系列删除");
      if (type === "hose_end" && payload.productType === "hose_end")
        payload.series = await validateHoseEndSeriesMaintenance(
          {
            findHoseEndSeries: async (c) =>
              (await findSeries(c)) ??
              (legacy?.kind === "series" && legacy.productType === "hose_end"
                ? legacy.series
                : null),
          },
          {
            actorId: input.actorId,
            mode,
            originalSeriesCode: code,
            series: {
              ...payload.series,
              representativeImageReference: imageReference,
            },
          },
        );
      if (exists) payload.series.seriesCode = code;
      if (payload.commercialRule) {
        payload.commercialRule = normalizeSeriesCommercialRule(
          payload.commercialRule,
        );
        if (
          payload.commercialRule.productType !== type ||
          payload.commercialRule.seriesCode !== code
        )
          throw new CatalogItemRejected(
            "Rule identity mismatch / 销售规则归属错误",
          );
      }
      const column = productSeriesKeys[type].replace(
        /[A-Z]/g,
        (c) => "_" + c.toLowerCase(),
      );
      const children = await database
        .prepare(
          `SELECT m.sku FROM ${productItemTables[type]} m ${active} JOIN catalog_runtime_skus s ON s.import_id=m.import_id AND s.sku=m.sku WHERE m.${column}=? AND s.catalog_publication_status='Published'`,
        )
        .bind(code)
        .all<{ sku: string }>();
      if (
        input.targetState === "online" &&
        children.results.length &&
        !payload.commercialRule
      )
        throw new CatalogItemRejected(
          "Published children require sales rules / 上线子体需要销售规则，请前往销售、包装和价格",
        );
      if (
        input.targetState === "online" &&
        !payload.mediaVersionId &&
        type === "hose_end"
      )
        for (const child of children.results) {
          const p = await read(type, "sku", child.sku);
          if (!p?.mediaVersionId)
            throw new CatalogItemRejected(
              "Published children require an image / 上线子体需要图片",
            );
        }
    } else {
      const parent = await read(type, "series", itemSeriesCode(payload));
      if (payload.productType === "hose_end")
        payload.variant = (
          await validateHoseEndVariantMaintenance(
            {
              findHoseEndSeries: findSeries,
              findProductIdentity: async () =>
                exists ? { sku: code, productType: type } : null,
            },
            {
              actorId: input.actorId,
              mode,
              originalSku: code,
              lifecycleStatus: input.targetState,
              imageOverrideReference: imageReference || null,
              variant: payload.variant,
            },
          )
        ).variant;
      else {
        const lifecycle = productLifecycleState(input.targetState);
        const values = {
          ...payload.variant,
          ...(type === "adapter" ? { adapterSku: code } : {}),
          catalogPublicationStatus: lifecycle.catalogPublicationStatus,
          rfqEligibility: lifecycle.rfqEligibility,
        } as Record<string, CatalogWorkbookCell>;
        const master = validateItemComponent({
          productType: type,
          masterValues: values,
          mode,
          originalSku: code,
          originalSalesSku: code,
          salesValues: {},
          mainImageReference:
            imageReference || (await reference(parent?.mediaVersionId ?? null)),
        });
        payload.variant = master as typeof payload.variant;
      }
      if (payload.productType === "hose_end" && parent?.kind === "series")
        payload.variant.fittingSeries = parent.series.seriesCode;
      if (exists) payload.variant.sku = code;
      if (payload.price) payload.price = normalizeItemPrice(payload.price);
      // Imported inapplicable values remain in the old revision; new proposals must be clean.
      validateProductPackaging(
        type,
        null,
        payload.price?.packageLengthFt ?? null,
      );
      if (input.targetState === "online") {
        if (
          parent?.kind !== "series" ||
          !parent.commercialRule ||
          payload.price?.amount == null ||
          (!payload.mediaVersionId && !parent.mediaVersionId)
        )
          throw new CatalogItemRejected(
            "Online SKU requires price, image and sales rules; open Sales, Packaging and Pricing / 上线需要价格、图片和销售规则，请前往销售、包装和价格",
          );
        normalizeSeriesCommercialRule(parent.commercialRule);
      }
    }
    return payload;
  }
  return { read, validate, reference };
}
