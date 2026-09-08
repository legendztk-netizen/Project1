import { createD1CatalogItemRepository } from "./d1-catalog-item-repository";
import {
  commercialProductTypes,
  type CommercialProductType,
} from "../domain/catalog-commercial-maintenance";
import {
  CatalogItemRejected,
  catalogCommandHash,
  type CatalogItemPayload,
} from "../domain/catalog-item-publication";
import {
  paginateProductGroups,
  selectionActions,
} from "../domain/catalog-product-management";
import { itemSeriesCode } from "./d1-additional-catalog-items";
export interface ProductSelection {
  kind: "series" | "sku";
  productType: CommercialProductType;
  code: string;
}
export interface ManagedProduct extends ProductSelection {
  seriesCode: string;
  name: string;
  imageId: string | null;
  dimensions: string;
  amount: number | null;
  currency: string;
  state: string;
  revisionId: string | null;
  draftRevisionId: string | null;
  assemblyPending: boolean;
}
export interface ProductGroup {
  item: ManagedProduct;
  children: ManagedProduct[];
}
const facts = `
 SELECT 'hose' AS type,m.sku,m.hose_series AS series_code,CAST(m.nominal_id_in AS TEXT)||' in' AS dimensions FROM catalog_runtime_hose_variants m WHERE m.import_id=?1
 UNION ALL SELECT 'hose_end',m.sku,m.fitting_series,m.connection_dash||' / '||m.hose_tail_dash FROM catalog_runtime_hose_ends m WHERE m.import_id=?1
 UNION ALL SELECT 'ferrule',m.sku,m.ferrule_series,m.hose_tail_dash||' / '||m.hose_construction FROM catalog_runtime_ferrules m WHERE m.import_id=?1
 UNION ALL SELECT 'adapter',m.sku,m.adapter_family_id,m.interface_1||' '||COALESCE(m.size_1,'')||' / '||m.interface_2||' '||COALESCE(m.size_2,'') FROM catalog_runtime_adapters m WHERE m.import_id=?1
 UNION ALL SELECT 'quick_coupler',m.sku,m.coupler_series,m.body_size||' / '||m.port_thread FROM catalog_runtime_quick_couplers m WHERE m.import_id=?1`;
export function createD1ProductManagementRepository(database: D1Database) {
  const items = createD1CatalogItemRepository(database);
  async function all(): Promise<ManagedProduct[]> {
    const active = await database
      .prepare(
        "SELECT r.source_import_id FROM catalog_active_release a JOIN catalog_releases r ON r.id=a.release_id WHERE a.singleton=1",
      )
      .first<{ source_import_id: string }>();
    if (!active) return [];
    const [rows, series, extras] = await database.batch<
      Record<string, unknown>
    >([
      database
        .prepare(
          `SELECT f.*,s.catalog_publication_status,COALESCE(p.currency,o.currency,'USD') AS currency,CASE WHEN p.id IS NOT NULL THEN p.reference_price_usd ELSE o.reference_price_usd END AS amount,image.media_version_id,
    e.current_revision_id,e.draft_revision_id,d.invalidated_sequence>d.generated_sequence AS dirty
    FROM (${facts}) f JOIN catalog_runtime_skus s ON s.sku=f.sku AND s.import_id=?1
    LEFT JOIN catalog_product_entities e ON e.kind='sku' AND e.code=f.sku
    LEFT JOIN catalog_runtime_sku_price_packaging p ON p.sku=f.sku AND p.import_id=?1
    LEFT JOIN catalog_runtime_sales_offers o ON o.base_sku=f.sku AND o.import_id=?1
    LEFT JOIN catalog_runtime_product_main_images image ON image.sku=f.sku AND image.import_id=?1
    LEFT JOIN catalog_item_assembly_state d ON d.hose_series=f.series_code AND f.type='hose'
    WHERE e.hidden_at IS NULL`,
        )
        .bind(active.source_import_id),
      database
        .prepare(
          `SELECT 'hose' AS type,series_code,series_name,representative_media_version_id AS image_id FROM catalog_runtime_hose_series WHERE import_id=?1
     UNION ALL SELECT 'hose_end',series_code,series_name,representative_media_version_id FROM catalog_runtime_hose_end_series WHERE import_id=?1`,
        )
        .bind(active.source_import_id),
      database.prepare(
        `SELECT e.*,r.payload_json,r.target_state FROM catalog_product_entities e LEFT JOIN catalog_product_revisions r ON r.id=COALESCE(e.current_revision_id,e.draft_revision_id)`,
      ),
    ]);
    const result: ManagedProduct[] = rows.results.map((r) => ({
      kind: "sku",
      productType: r.type as CommercialProductType,
      code: String(r.sku),
      seriesCode: String(r.series_code ?? ""),
      name: String(r.sku),
      imageId: r.media_version_id as string | null,
      dimensions: String(r.dimensions ?? ""),
      amount: r.amount as number | null,
      currency: String(r.currency),
      state:
        r.catalog_publication_status === "Published"
          ? "online"
          : r.catalog_publication_status === "Archived"
            ? "discontinued"
            : "draft",
      revisionId: r.current_revision_id as string | null,
      draftRevisionId: r.draft_revision_id as string | null,
      assemblyPending: Boolean(r.dirty),
    }));
    for (const r of series.results)
      result.push({
        kind: "series",
        productType: r.type as CommercialProductType,
        code: String(r.series_code),
        seriesCode: String(r.series_code),
        name: String(r.series_name),
        imageId: r.image_id as string | null,
        dimensions: "",
        amount: null,
        currency: "USD",
        state: "online",
        revisionId: null,
        draftRevisionId: null,
        assemblyPending: false,
      });
    for (const sku of result)
      if (
        sku.kind === "sku" &&
        sku.seriesCode &&
        !result.some(
          (r) =>
            r.kind === "series" &&
            r.productType === sku.productType &&
            r.code === sku.seriesCode,
        )
      )
        result.push({
          ...sku,
          kind: "series",
          code: sku.seriesCode,
          name: sku.seriesCode,
          dimensions: "",
          amount: null,
          imageId: null,
        });
    for (const r of extras.results) {
      const index = result.findIndex(
        (p) =>
          p.kind === r.kind &&
          p.productType === r.product_type &&
          p.code === r.code,
      );
      if (r.hidden_at) {
        if (index >= 0) result.splice(index, 1);
        continue;
      }
      if (index >= 0) {
        result[index].revisionId = r.current_revision_id as string | null;
        result[index].draftRevisionId = r.draft_revision_id as string | null;
        continue;
      }
      if (!r.payload_json) continue;
      const p = JSON.parse(String(r.payload_json)) as CatalogItemPayload;
      result.push({
        kind: p.kind,
        productType: p.productType,
        code: String(r.code),
        seriesCode: itemSeriesCode(p),
        name: p.kind === "series" ? p.series.seriesName : String(r.code),
        imageId: p.mediaVersionId,
        dimensions: "",
        amount: p.kind === "sku" ? (p.price?.amount ?? null) : null,
        currency: p.kind === "sku" ? (p.price?.currency ?? "USD") : "USD",
        state: String(r.target_state),
        revisionId: r.current_revision_id as string | null,
        draftRevisionId: r.draft_revision_id as string | null,
        assemblyPending: false,
      });
    }
    for (const sku of result)
      if (
        sku.kind === "sku" &&
        sku.seriesCode &&
        !result.some(
          (r) =>
            r.kind === "series" &&
            r.productType === sku.productType &&
            r.code === sku.seriesCode,
        )
      )
        result.push({
          ...sku,
          kind: "series",
          code: sku.seriesCode,
          name: sku.seriesCode,
          dimensions: "",
          amount: null,
          imageId: null,
        });
    return result;
  }
  async function deletionPlan(selected: ProductSelection[]) {
    if (!selectionActions(selected).delete)
      throw new CatalogItemRejected(
        "Select one series or one or more SKUs / 请选择一个系列或若干 SKU",
      );
    const rows = await all();
    const targets: ManagedProduct[] = [];
    let blockers = 0;
    for (const selection of selected) {
      const row = rows.find(
        (r) =>
          r.kind === selection.kind &&
          r.productType === selection.productType &&
          r.code === selection.code,
      );
      if (!row)
        throw new CatalogItemRejected("Product not found / 产品不存在", 404);
      targets.push(row);
      if (row.kind === "series") {
        const children = rows.filter(
          (r) =>
            r.kind === "sku" &&
            r.productType === row.productType &&
            r.seriesCode === row.code,
        );
        blockers += children.filter((c) => c.state === "online").length;
        targets.push(...children);
      }
    }
    const requests = (
      await database
        .prepare(
          "SELECT id,payload_json,dependencies_json FROM catalog_product_change_requests WHERE status='pending'",
        )
        .all<{ id: string; payload_json: string; dependencies_json: string }>()
    ).results;
    const requestIds = requests
      .filter((r) => {
        const p = (
          JSON.parse(r.payload_json) as { payload: CatalogItemPayload }
        ).payload;
        return targets.some(
          (t) =>
            t.kind === p.kind &&
            t.productType === p.productType &&
            t.code ===
              (p.kind === "series" ? p.series.seriesCode : p.variant.sku),
        );
      })
      .map((r) => r.id);
    blockers += requests.filter(
      (r) =>
        !requestIds.includes(r.id) &&
        (JSON.parse(r.dependencies_json) as string[]).some((d) =>
          requestIds.includes(d),
        ),
    ).length;
    return { targets, requestIds, blockers };
  }
  async function remove(
    selected: ProductSelection[],
    commandId: string,
    actorId: string,
    ipAddress: string,
  ) {
    const hash = await catalogCommandHash(selected);
    const prior = await database
      .prepare(
        "SELECT command_hash,payload_json FROM catalog_product_deletions WHERE id=?",
      )
      .bind(commandId)
      .first<{ command_hash: string; payload_json: string }>();
    if (prior) {
      if (prior.command_hash !== hash)
        throw new CatalogItemRejected(
          "Command identity already used / 提交标识已使用",
          409,
        );
      return JSON.parse(prior.payload_json) as { removed: string[] };
    }
    if (!selectionActions(selected).delete)
      throw new CatalogItemRejected("Invalid selection / 选择无效");
    if (selected.every((s) => s.kind === "sku")) {
      const results = [];
      for (const selection of selected) {
        try {
          const payload =
            (await items.findProductPayload(
              selection.productType,
              "sku",
              selection.code,
            )) ??
            (await items.findProductPayload(
              selection.productType,
              "sku",
              selection.code,
              true,
            ));
          if (!payload)
            throw new CatalogItemRejected(
              "Product not found / 产品不存在",
              404,
            );
          await items.apply({
            commandId: `${commandId}:${selection.code}`,
            actorId,
            ipAddress,
            payload,
            mode: "edit",
            targetState: "discontinued",
            baselineRevisionId: null,
            source: { channel: "manual", operation: "delete" },
          });
          results.push({ code: selection.code, ok: true });
        } catch (error) {
          results.push({
            code: selection.code,
            ok: false,
            error: error instanceof Error ? error.message : "删除失败",
          });
        }
      }
      return { results };
    }
    const plan = await deletionPlan(selected);
    if (plan.blockers)
      throw new CatalogItemRejected(
        `Deletion blocked by ${plan.blockers} active children or dependent requests / ${plan.blockers} 个上线子体或有效依赖阻止删除`,
        409,
      );
    const state = await items.state();
    if (state.mode !== "items")
      throw new CatalogItemRejected(
        "Enable item publication first / 请先启用条目发布",
        409,
      );
    const payload = {
      removed: plan.targets.map((t) => t.code),
      targets: plan.targets.map((t) => ({
        kind: t.kind,
        productType: t.productType,
        code: t.code,
      })),
      requestIds: plan.requestIds,
    };
    const time = new Date().toISOString();
    await database.batch([
      database
        .prepare(
          "INSERT INTO catalog_product_deletions(id,command_hash,expected_generation,payload_json,actor_id,occurred_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          commandId,
          hash,
          state.generation,
          JSON.stringify(payload),
          actorId,
          time,
        ),
      ...plan.targets.map((t) =>
        database
          .prepare(
            "INSERT INTO catalog_product_entities(id,kind,product_type,code,hidden_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,product_type,code) DO UPDATE SET hidden_at=excluded.hidden_at",
          )
          .bind(crypto.randomUUID(), t.kind, t.productType, t.code, time),
      ),
      ...plan.requestIds.map((id) =>
        database
          .prepare(
            "UPDATE catalog_product_change_requests SET status='deleted' WHERE id=? AND status='pending'",
          )
          .bind(id),
      ),
      database.prepare(
        "UPDATE catalog_item_publication_state SET generation=generation+1 WHERE singleton=1",
      ),
      database
        .prepare(
          "INSERT INTO admin_audit_events(id,event_type,entity_type,entity_id,actor_id,payload_json,occurred_at) VALUES(?,'catalog_item.deleted','product_series',?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          selected[0].code,
          actorId,
          JSON.stringify({ ...payload, ipAddress }),
          time,
        ),
    ]);
    return payload;
  }
  return {
    all,
    deletionPlan,
    remove,
    async list(input: {
      types: CommercialProductType[];
      query: string;
      page: number;
      pageSize: 20 | 50;
    }) {
      const rows = (await all()).filter(
        (r) => !input.types.length || input.types.includes(r.productType),
      );
      const q = input.query.toUpperCase().trim();
      const groups: ProductGroup[] = [];
      for (const row of rows.filter((r) => r.kind === "series")) {
        const children = rows.filter(
          (r) =>
            r.kind === "sku" &&
            r.productType === row.productType &&
            r.seriesCode === row.code &&
            (!q || r.code.includes(q)),
        );
        if (!q || children.length || row.code.includes(q))
          groups.push({ item: row, children });
      }
      for (const row of rows.filter(
        (r) =>
          r.kind === "sku" &&
          !rows.some(
            (s) =>
              s.kind === "series" &&
              s.productType === r.productType &&
              s.code === r.seriesCode,
          ),
      ))
        if (!q || row.code.includes(q))
          groups.push({ item: row, children: [] });
      groups.sort(
        (a, b) =>
          commercialProductTypes.indexOf(a.item.productType) -
            commercialProductTypes.indexOf(b.item.productType) ||
          a.item.code.localeCompare(b.item.code),
      );
      return paginateProductGroups(groups, input.page, input.pageSize);
    },
  };
}
