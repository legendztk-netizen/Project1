/** Allowlisted, read-only access to retained releases. Never uses current-item views. */
export const historySections = {
  catalog_skus: "产品及原工作表",
  catalog_hose_series: "胶管系列",
  catalog_hose_variants: "胶管参数",
  catalog_hose_end_series: "压接接头系列",
  catalog_hose_ends: "压接接头参数",
  catalog_ferrules: "套筒参数",
  catalog_adapter_families: "过渡接头系列",
  catalog_adapters: "过渡接头参数",
  catalog_quick_couplers: "快速接头参数",
  catalog_series_commercial_rules: "系列销售规则",
  catalog_sku_price_packaging: "价格和包装",
  catalog_sales_offers: "原销售报价",
  catalog_product_main_images: "原图片版本引用",
  catalog_compatibilities: "兼容及压接来源",
  catalog_configurator_registry_entries: "配置参考规则",
} as const;
export async function readCatalogHistory(db: D1Database, url: URL) {
  const releaseId = url.searchParams.get("release") || null;
  const requested = url.searchParams.get("section") ?? "catalog_skus";
  const section = Object.hasOwn(historySections, requested)
    ? (requested as keyof typeof historySections)
    : "catalog_skus";
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const requestedPage =
    Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status") ?? "";
  const release = releaseId
    ? await db
        .prepare(
          `SELECT r.*, i.source_file_name FROM catalog_releases r LEFT JOIN catalog_imports i ON i.id=r.source_import_id WHERE r.id=?`,
        )
        .bind(releaseId)
        .first<Record<string, string | number | null>>()
    : null;
  if (releaseId && !release)
    throw new Response("历史目录不存在", { status: 404 });
  let where: string, values: (string | number | null)[], table: string;
  if (release) {
    table = section;
    where =
      section === "catalog_configurator_registry_entries"
        ? "release_id = ?"
        : "import_id = ?";
    values = [
      section === "catalog_configurator_registry_entries"
        ? release.id
        : release.source_import_id,
    ];
    if (section === "catalog_skus" && query) {
      where += " AND instr(lower(sku), lower(?)) > 0";
      values.push(query);
    }
  } else {
    table = "catalog_releases";
    where = "1=1";
    values = [];
    if (["draft", "published", "superseded"].includes(status)) {
      where += " AND status=?";
      values.push(status);
    }
    if (query) {
      where +=
        " AND (instr(lower(release_number),lower(?))>0 OR instr(lower(id),lower(?))>0)";
      values.push(query, query);
    }
  }
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`)
    .bind(...values)
    .first<{ total: number }>();
  const total = count?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const page = Math.min(requestedPage, pages);
  const order = release ? "rowid" : "created_at DESC, id";
  const rows = await db
    .prepare(
      `SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT 20 OFFSET ?`,
    )
    .bind(...values, (page - 1) * 20)
    .all<Record<string, unknown>>();
  return {
    release,
    releaseId,
    section,
    query,
    status,
    total,
    pages,
    page,
    rows: rows.results,
  };
}
