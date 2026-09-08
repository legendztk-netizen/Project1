import {
  catalogCommandHash,
  CatalogItemRejected,
  itemCode,
  itemCompatibilityKey,
  normalizeItemPrice,
  type CatalogItemCommand,
  type CatalogItemPayload,
  type CatalogItemResult,
} from "../domain/catalog-item-publication";
import {
  validateHoseSeriesMaintenance,
  validateHoseVariantMaintenance,
  type HoseSeriesRecord,
  type HoseVariantInput,
} from "../domain/catalog-hose-maintenance";
import {
  normalizeSeriesCommercialRule,
  type SeriesCommercialRule,
} from "../domain/catalog-commercial-maintenance";
import type { ProductLifecycleStatus } from "../domain/catalog-product-lifecycle";

export interface ItemState {
  mode: "legacy" | "items";
  generation: number;
  baseline_release_id: string | null;
}
interface RevisionRow {
  id: string;
  sequence: number;
  target_state: ProductLifecycleStatus;
  command_hash: string;
  actor_id: string;
  payload_json: string;
}

function camelRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
function result(row: RevisionRow): CatalogItemResult {
  return {
    revisionId: row.id,
    sequence: row.sequence,
    targetState: row.target_state,
  };
}

export function createD1CatalogItemRepository(
  database: D1Database,
  now = () => new Date(),
) {
  async function state() {
    return (await database
      .prepare(
        "SELECT mode, generation, baseline_release_id FROM catalog_item_publication_state WHERE singleton = 1",
      )
      .first<ItemState>())!;
  }
  async function mediaReference(id: string | null) {
    if (!id) return null;
    const row = await database
      .prepare(
        "SELECT approved_reference FROM catalog_media_versions WHERE id = ?",
      )
      .bind(id)
      .first<{ approved_reference: string | null }>();
    if (!row)
      throw new CatalogItemRejected(
        "Image version does not exist / 图片版本不存在",
      );
    return row.approved_reference ?? `media-version:${id}`;
  }
  async function findHoseSeries(
    code: string,
  ): Promise<HoseSeriesRecord | null> {
    const row = await database
      .prepare(
        `SELECT hs.* FROM catalog_runtime_hose_series hs
      JOIN catalog_releases r ON r.source_import_id = hs.import_id
      JOIN catalog_active_release a ON a.release_id = r.id WHERE hs.series_code = ?`,
      )
      .bind(code)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return {
      ...camelRow(row),
      representativeImageReference:
        (await mediaReference(
          row.representative_media_version_id as string | null,
        )) ?? "",
    } as unknown as HoseSeriesRecord;
  }
  async function findProductIdentity(sku: string) {
    return database
      .prepare(
        `SELECT s.sku, s.product_type AS productType FROM catalog_runtime_skus s
      JOIN catalog_releases r ON r.source_import_id = s.import_id
      JOIN catalog_active_release a ON a.release_id = r.id WHERE s.sku = ?`,
      )
      .bind(sku)
      .first<{
        sku: string;
        productType:
          "hose" | "hose_end" | "ferrule" | "adapter" | "quick_coupler";
      }>();
  }
  async function findPayload(
    kind: "series" | "sku",
    code: string,
    draft = false,
  ): Promise<CatalogItemPayload | null> {
    if (draft) {
      const revision = await database
        .prepare(
          `SELECT r.payload_json FROM catalog_product_entities e JOIN catalog_product_revisions r ON r.id = e.draft_revision_id WHERE e.kind = ? AND e.product_type = 'hose' AND e.code = ?`,
        )
        .bind(kind, code)
        .first<{ payload_json: string }>();
      if (revision)
        return JSON.parse(revision.payload_json) as CatalogItemPayload;
    }
    if (kind === "series") {
      const series = await findHoseSeries(code);
      if (!series) return null;
      const [rule, image] = await database.batch<Record<string, unknown>>([
        database
          .prepare(
            `SELECT cr.* FROM catalog_runtime_series_commercial_rules cr
          JOIN catalog_releases r ON r.source_import_id = cr.import_id JOIN catalog_active_release a ON a.release_id = r.id
          WHERE cr.product_type = 'hose' AND cr.series_code = ?`,
          )
          .bind(code),
        database
          .prepare(
            `SELECT hs.representative_media_version_id AS id FROM catalog_runtime_hose_series hs
          JOIN catalog_releases r ON r.source_import_id = hs.import_id JOIN catalog_active_release a ON a.release_id = r.id WHERE hs.series_code = ?`,
          )
          .bind(code),
      ]);
      return {
        kind,
        productType: "hose",
        series,
        commercialRule: rule.results[0]
          ? (camelRow(rule.results[0]) as unknown as SeriesCommercialRule)
          : null,
        mediaVersionId: image.results[0]?.id as string | null,
      };
    }
    const row = await database
      .prepare(
        `SELECT h.*, s.technical_data_status,
      CASE WHEN p.id IS NOT NULL THEN p.units_per_sales_pack ELSE o.units_per_sales_pack END AS units_per_sales_pack, CASE WHEN p.id IS NOT NULL THEN p.net_unit_weight_kg ELSE o.net_unit_weight_kg END AS net_unit_weight_kg, CASE WHEN p.id IS NOT NULL THEN p.inner_pack_qty ELSE o.inner_pack_qty END AS inner_pack_qty, CASE WHEN p.id IS NOT NULL THEN p.master_carton_qty ELSE o.master_carton_qty END AS master_carton_qty, CASE WHEN p.id IS NOT NULL THEN p.carton_gross_weight_kg ELSE o.carton_gross_weight_kg END AS carton_gross_weight_kg, CASE WHEN p.id IS NOT NULL THEN p.carton_l_cm ELSE o.carton_l_cm END AS carton_l_cm, CASE WHEN p.id IS NOT NULL THEN p.carton_w_cm ELSE o.carton_w_cm END AS carton_w_cm, CASE WHEN p.id IS NOT NULL THEN p.carton_h_cm ELSE o.carton_h_cm END AS carton_h_cm, CASE WHEN p.id IS NOT NULL THEN p.packing_basis ELSE o.packing_basis END AS packing_basis,
      CASE WHEN p.id IS NOT NULL THEN p.reference_price_usd ELSE o.reference_price_usd END AS amount,
      COALESCE(p.currency, o.currency) AS currency, COALESCE(p.package_length_ft, o.package_length_ft) AS package_length_ft, image.media_version_id
      FROM catalog_runtime_hose_variants h
      JOIN catalog_releases r ON r.source_import_id = h.import_id JOIN catalog_active_release a ON a.release_id = r.id
      JOIN catalog_runtime_skus s ON s.import_id = h.import_id AND s.sku = h.sku
      LEFT JOIN catalog_runtime_sku_price_packaging p ON p.import_id = h.import_id AND p.sku = h.sku
      LEFT JOIN catalog_runtime_sales_offers o ON o.import_id = h.import_id AND o.base_sku = h.sku
      LEFT JOIN catalog_runtime_product_main_images image ON image.import_id = h.import_id AND image.sku = h.sku AND image.assignment_kind = 'override'
      WHERE h.sku = ?`,
      )
      .bind(code)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const data = camelRow(row);
    const keys = [
      "bendRadiusMm",
      "burstBar",
      "dash",
      "hoseSeries",
      "idMm",
      "mshaMarking",
      "nominalIdIn",
      "notes",
      "odMm",
      "skiveRequirement",
      "sku",
      "source",
      "technicalDataStatus",
      "weightKgM",
      "workingBar",
      "workingPsi",
    ];
    return {
      kind,
      productType: "hose",
      variant: Object.fromEntries(
        keys.map((key) => [key, data[key]]),
      ) as unknown as HoseVariantInput,
      price: row.currency
        ? {
            amount: row.amount as number | null,
            currency: row.currency as string,
            packageLengthFt: row.package_length_ft as number | null,
            unitsPerSalesPack: row.units_per_sales_pack as number | null,
            netUnitWeightKg: row.net_unit_weight_kg as number | null,
            innerPackQty: row.inner_pack_qty as number | null,
            masterCartonQty: row.master_carton_qty as number | null,
            cartonGrossWeightKg: row.carton_gross_weight_kg as number | null,
            cartonLCm: row.carton_l_cm as number | null,
            cartonWCm: row.carton_w_cm as number | null,
            cartonHCm: row.carton_h_cm as number | null,
            packingBasis: row.packing_basis as string | null,
          }
        : null,
      mediaVersionId: row.media_version_id as string | null,
    };
  }
  async function validate(input: CatalogItemCommand, fromRequest: boolean) {
    if (!input.actorId || !/^[A-Za-z0-9:_-]{8,160}$/.test(input.commandId))
      throw new CatalogItemRejected("Invalid command identity / 提交标识无效");
    if (
      !["online", "draft", "discontinued"].includes(input.targetState) ||
      !["create", "edit"].includes(input.mode)
    )
      throw new CatalogItemRejected("Invalid operation / 操作无效");
    const payload = structuredClone(input.payload);
    if (payload.productType !== "hose")
      throw new CatalogItemRejected(
        "This entry supports Hose / 此入口支持胶管",
      );
    const code = itemCode(payload);
    if (!/^[A-Z0-9_-]+$/.test(code))
      throw new CatalogItemRejected(
        "Invalid immutable product code / 产品编号无效",
      );
    const imageReference = await mediaReference(payload.mediaVersionId);
    const entity = await database
      .prepare(
        "SELECT id FROM catalog_product_entities WHERE kind = ? AND code = ?",
      )
      .bind(payload.kind, code)
      .first();
    const legacy =
      payload.kind === "series"
        ? await findHoseSeries(code)
        : await findProductIdentity(code);
    if (!fromRequest && input.mode === "create" && (entity || legacy))
      throw new CatalogItemRejected(
        "Product identity already exists / 产品编号已存在",
        409,
      );
    if (input.mode === "edit" && !entity && !legacy)
      throw new CatalogItemRejected("Product not found / 产品不存在", 404);
    const maintenanceMode =
      fromRequest && (entity || legacy) ? "edit" : input.mode;
    if (payload.kind === "series") {
      if (input.targetState === "discontinued")
        throw new CatalogItemRejected(
          "Series has no independent discontinued state / 系列不单独停用",
        );
      payload.series = await validateHoseSeriesMaintenance(
        {
          findHoseSeries: async (value) =>
            (await findHoseSeries(value)) ??
            (
              (await findPayload("series", value, true)) as Extract<
                CatalogItemPayload,
                { kind: "series" }
              > | null
            )?.series ??
            null,
        },
        {
          actorId: input.actorId,
          mode: maintenanceMode,
          originalSeriesCode: code,
          series: {
            ...payload.series,
            representativeImageReference: imageReference ?? "",
          },
        },
      );
      if (payload.commercialRule) {
        payload.commercialRule = normalizeSeriesCommercialRule(
          payload.commercialRule,
        );
        if (
          payload.commercialRule.seriesCode !== code ||
          payload.commercialRule.productType !== "hose"
        )
          throw new CatalogItemRejected(
            "Sales rule must belong to this series / 销售规则必须属于本系列",
          );
      }
      if (input.targetState === "online") {
        const children = await database
          .prepare(
            `SELECT s.sku FROM catalog_runtime_skus s
          JOIN catalog_releases r ON r.source_import_id = s.import_id JOIN catalog_active_release a ON a.release_id = r.id
          WHERE s.product_type = 'hose' AND s.hose_series = ? AND s.catalog_publication_status = 'Published'`,
          )
          .bind(code)
          .all<{ sku: string }>();
        for (const child of children.results) {
          const owned = await findPayload("sku", child.sku);
          if (
            !payload.commercialRule ||
            (owned?.kind === "sku" &&
              !owned.mediaVersionId &&
              !payload.mediaVersionId)
          )
            throw new CatalogItemRejected(
              "Published children require a series sales rule and an image / 上线子体需要有效销售规则及图片",
            );
          if (
            (payload.commercialRule.salesUnit !== "ft" ||
              !payload.commercialRule.quantityInputMode
                .toLowerCase()
                .includes("length")) &&
            owned?.kind === "sku" &&
            !owned.price?.packageLengthFt
          )
            throw new CatalogItemRejected(
              "Published packaged Hose requires package length / 上线包装胶管需要包装长度",
            );
        }
      }
    } else if (payload.kind === "sku") {
      const validated = await validateHoseVariantMaintenance(
        {
          findHoseSeries,
          findProductIdentity: async (value) =>
            (await findProductIdentity(value)) ??
            (entity ? { sku: value, productType: "hose" as const } : null),
        },
        {
          actorId: input.actorId,
          mode: maintenanceMode,
          originalSku: code,
          lifecycleStatus: input.targetState,
          imageOverrideReference: imageReference,
          variant: payload.variant,
        },
      );
      payload.variant = validated.variant;
      const parent = await findPayload("series", payload.variant.hoseSeries);
      const rule = parent?.kind === "series" ? parent.commercialRule : null;
      if (payload.price) payload.price = normalizeItemPrice(payload.price);
      if (input.targetState === "online") {
        if (
          !rule ||
          payload.price?.amount == null ||
          (!payload.mediaVersionId && !parent?.mediaVersionId)
        )
          throw new CatalogItemRejected(
            "Online SKU requires price, image and series sales rule / 上线需要价格、图片和系列销售规则",
          );
        normalizeSeriesCommercialRule(rule);
        if (
          rule.salesUnit !== "ft" ||
          !rule.quantityInputMode.toLowerCase().includes("length")
        ) {
          if (!payload.price.packageLengthFt)
            throw new CatalogItemRejected(
              "Packaged Hose requires package length / 定长包装胶管需要包装长度",
            );
        } else if (!rule.minimumLengthPerPieceFt || !rule.lengthIncrementFt)
          throw new CatalogItemRejected(
            "Length ordering rules are incomplete / 长度销售规则不完整",
          );
      }
    } else throw new CatalogItemRejected("Invalid entity type / 条目类型无效");
    return payload;
  }
  async function apply(
    input: CatalogItemCommand,
    requestId: string | null = null,
  ): Promise<CatalogItemResult> {
    const hash = await catalogCommandHash(input);
    function replay(row: RevisionRow) {
      if (row.command_hash !== hash || row.actor_id !== input.actorId)
        throw new CatalogItemRejected(
          "Command identity already used / 提交标识已使用",
          409,
        );
      return result(row);
    }
    async function existing() {
      return database
        .prepare("SELECT * FROM catalog_product_revisions WHERE command_id = ?")
        .bind(input.commandId)
        .first<RevisionRow>();
    }
    const prior = await existing();
    if (prior) return replay(prior);
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await state();
      if (current.mode !== "items")
        throw new CatalogItemRejected(
          "Item publication is not enabled / 条目发布未启用",
          409,
        );
      let payload: CatalogItemPayload;
      try {
        payload = await validate(input, requestId !== null);
      } catch (error) {
        if (error instanceof TypeError)
          throw new CatalogItemRejected(
            "Incomplete product payload / 产品数据不完整",
          );
        throw error;
      }
      const code = itemCode(payload);
      const previous = await database
        .prepare(
          "SELECT revision_id AS id FROM catalog_item_current WHERE kind = ? AND product_type = 'hose' AND code = ?",
        )
        .bind(payload.kind, code)
        .first<{ id: string }>();
      let affected: string[] = [];
      if (payload.kind === "sku" && input.targetState !== "draft") {
        const old = await database
          .prepare(
            `SELECT h.hose_series, h.dash, h.skive_requirement, s.catalog_publication_status
          FROM catalog_runtime_hose_variants h JOIN catalog_runtime_skus s ON s.import_id = h.import_id AND s.sku = h.sku
          JOIN catalog_releases r ON r.source_import_id = h.import_id JOIN catalog_active_release a ON a.release_id = r.id WHERE h.sku = ?`,
          )
          .bind(code)
          .first<{
            hose_series: string;
            dash: string;
            skive_requirement: string | null;
            catalog_publication_status: string;
          }>();
        const before = old
          ? itemCompatibilityKey({
              hoseSeries: old.hose_series,
              dash: old.dash,
              skiveRequirement: old.skive_requirement,
              state:
                old.catalog_publication_status === "Published"
                  ? "online"
                  : "discontinued",
            })
          : null;
        if (
          before !==
          itemCompatibilityKey({ ...payload.variant, state: input.targetState })
        )
          affected = [
            ...new Set(
              [old?.hose_series, payload.variant.hoseSeries].filter(
                (value): value is string => Boolean(value),
              ),
            ),
          ];
      }
      const revisionId = crypto.randomUUID();
      try {
        await database.batch([
          database
            .prepare(
              "INSERT INTO catalog_product_entities(id, kind, product_type, code) VALUES (?, ?, 'hose', ?) ON CONFLICT DO NOTHING",
            )
            .bind(crypto.randomUUID(), payload.kind, code),
          database
            .prepare(
              `INSERT INTO catalog_product_revisions(id, entity_id, target_state, payload_json, media_version_id,
            source_json, affected_series_json, baseline_revision_id, previous_revision_id, request_id,
            command_id, command_hash, expected_generation, actor_id, ip_address, occurred_at)
            SELECT ?, e.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM catalog_product_entities e
            WHERE e.kind = ? AND e.product_type = 'hose' AND e.code = ?`,
            )
            .bind(
              revisionId,
              input.targetState,
              JSON.stringify(payload),
              payload.mediaVersionId,
              JSON.stringify(input.source),
              JSON.stringify(affected),
              input.baselineRevisionId,
              previous?.id ??
                ((await findPayload(payload.kind, code))
                  ? `legacy:${current.baseline_release_id}:${payload.kind}:${code}`
                  : null),
              requestId,
              input.commandId,
              hash,
              current.generation,
              input.actorId,
              input.ipAddress,
              now().toISOString(),
              payload.kind,
              code,
            ),
        ]);
        return result(
          (await database
            .prepare("SELECT * FROM catalog_product_revisions WHERE id = ?")
            .bind(revisionId)
            .first<RevisionRow>())!,
        );
      } catch (error) {
        const duplicate = await existing();
        if (duplicate) return replay(duplicate);
        if (
          error instanceof Error &&
          error.message.includes("catalog item generation changed")
        )
          continue;
        throw error;
      }
    }
    throw new CatalogItemRejected(
      "Catalog is changing; retry this submission / 数据正在更新，请重试本次提交",
      409,
    );
  }
  return {
    state,
    findPayload,
    apply,
    async enable(input: { environment: string; actorId: string }) {
      if (!["local", "preview"].includes(input.environment))
        throw new CatalogItemRejected(
          "Production cutover belongs to Ticket 05 / 生产切换由 Ticket 05 完成",
          403,
        );
      if ((await state()).mode === "items") return;
      await database.batch([
        database.prepare(`UPDATE catalog_item_publication_state SET mode = 'items', baseline_release_id =
          (SELECT release_id FROM catalog_active_release WHERE singleton = 1)
          WHERE singleton = 1 AND mode = 'legacy' AND EXISTS
          (SELECT 1 FROM catalog_active_release a JOIN catalog_releases r ON r.id = a.release_id WHERE r.status = 'published')`),
        database
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          SELECT ?, 'catalog_item.enabled', 'catalog', baseline_release_id, ?, '{}', ?
          FROM catalog_item_publication_state WHERE mode = 'items'`,
          )
          .bind(crypto.randomUUID(), input.actorId, now().toISOString()),
      ]);
      if ((await state()).mode !== "items")
        throw new CatalogItemRejected(
          "Publish a legacy baseline before enabling / 请先发布基线目录",
          409,
        );
    },
    async listSeries() {
      return (
        await database
          .prepare(
            `SELECT hs.series_code AS code, hs.series_name AS name FROM catalog_runtime_hose_series hs
        JOIN catalog_releases r ON r.source_import_id = hs.import_id JOIN catalog_active_release a ON a.release_id = r.id ORDER BY hs.series_code`,
          )
          .all<{ code: string; name: string }>()
      ).results;
    },
    async history(kind: "series" | "sku", code: string) {
      const rows = await database
        .prepare(
          `SELECT r.* FROM catalog_product_revisions r JOIN catalog_product_entities e ON e.id = r.entity_id
        WHERE e.kind = ? AND e.product_type = 'hose' AND e.code = ? ORDER BY r.sequence DESC`,
        )
        .bind(kind, code)
        .all<RevisionRow>();
      return rows.results.map((row) => ({
        ...result(row),
        payload: JSON.parse(row.payload_json) as CatalogItemPayload,
      }));
    },
    async createRequest(
      input: CatalogItemCommand,
      original: unknown,
      dependencies: string[] = [],
    ) {
      const id = crypto.randomUUID();
      await database.batch([
        database
          .prepare(
            `INSERT INTO catalog_product_change_requests(id,payload_json,original_json,source_json,dependencies_json,
          baseline_revision_id,target_state,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            JSON.stringify(input),
            JSON.stringify(original),
            JSON.stringify(input.source),
            JSON.stringify(dependencies),
            input.baselineRevisionId,
            input.targetState,
            input.actorId,
            now().toISOString(),
          ),
        database
          .prepare(
            `INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at)
          VALUES (?, 'catalog_item.request_created', 'product_change_request', ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            input.actorId,
            JSON.stringify({
              source: input.source,
              baselineRevisionId: input.baselineRevisionId,
              dependencies,
            }),
            now().toISOString(),
          ),
      ]);
      return id;
    },
    async approveRequest(id: string, actorId: string, ipAddress: string) {
      const row = await database
        .prepare(
          "SELECT payload_json, dependencies_json FROM catalog_product_change_requests WHERE id = ?",
        )
        .bind(id)
        .first<{ payload_json: string; dependencies_json: string }>();
      if (!row)
        throw new CatalogItemRejected("Request not found / 请求不存在", 404);
      for (const dependency of JSON.parse(row.dependencies_json) as string[]) {
        const parent = await database
          .prepare(
            "SELECT status FROM catalog_product_change_requests WHERE id = ?",
          )
          .bind(dependency)
          .first<{ status: string }>();
        if (parent?.status !== "approved")
          throw new CatalogItemRejected(
            "Series dependency is pending / 系列依赖未批准",
            409,
          );
      }
      return apply(
        {
          ...(JSON.parse(row.payload_json) as CatalogItemCommand),
          commandId: `request:${id}`,
          actorId,
          ipAddress,
        },
        id,
      );
    },
  };
}
