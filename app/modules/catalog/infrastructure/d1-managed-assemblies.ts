import type { AdminIdentity } from "#workers/admin-access";
import {
  assemblyIdentity,
  assemblyDashMatches,
  deriveManagedCombinations,
  type AssemblyParts,
  type AssemblyEndpoint,
  type ManagedCombination,
} from "../domain/managed-assemblies";
import { CatalogItemRejected } from "../domain/catalog-item-publication";
import {
  validateCatalogWorksheetRecord,
  type CatalogWorkbookCell,
} from "../domain/catalog-workbook";

interface Token {
  sequence: number;
  relationVersion: number;
}
interface Product {
  sku: string;
  hose_series?: string;
  dash?: string;
  hose_tail_dash?: string;
  ferrule_series?: string;
  skive_requirement?: string;
  [key: string]: unknown;
}
interface OperationContext {
  id: string;
  ipAddress: string;
}
export interface SourceRow {
  id: string;
  source_json: string;
  status: string;
  issues_json: string;
  disposition_json: string | null;
}
const triple = (e: AssemblyEndpoint) =>
  JSON.stringify([e.hose_sku, e.hose_end_sku, e.ferrule_sku]);
const eligible = (e: AssemblyEndpoint) =>
  e.catalog_publication_status === "Published" &&
  e.rfq_eligibility === "Eligible";

export function createD1ManagedAssemblies(
  database: D1Database,
  actor: Pick<AdminIdentity, "id" | "catalogPermission">,
) {
  function authorize() {
    if (!actor.id || actor.catalogPermission === "view")
      throw new CatalogItemRejected("需要产品编辑权限", 403);
  }
  async function state() {
    const result = await database
      .prepare(
        `SELECT s.*,r.source_import_id AS importId FROM catalog_item_publication_state s
      LEFT JOIN catalog_releases r ON r.id=s.baseline_release_id`,
      )
      .first<{
        mode: string;
        generation: number;
        importId: string;
        baseline_release_id: string;
      }>();
    if (!result || result.mode !== "items")
      throw new CatalogItemRejected("条目发布未启用", 409);
    return result;
  }
  async function token(series: string): Promise<Token> {
    return (await database
      .prepare(
        `SELECT COALESCE((SELECT invalidated_sequence FROM catalog_item_assembly_state WHERE hose_series=?),0) AS sequence,
      COALESCE((SELECT relation_version FROM catalog_assembly_managed_series WHERE hose_series=?),0) AS relationVersion`,
      )
      .bind(series, series)
      .first<Token>())!;
  }
  async function pending() {
    return (
      await database
        .prepare(
          "SELECT hose_series FROM catalog_assembly_pending_series ORDER BY hose_series",
        )
        .all<{ hose_series: string }>()
    ).results.map((r) => r.hose_series);
  }
  async function replay(
    context: OperationContext,
    kind: string,
    request: unknown,
  ) {
    const old = await database
      .prepare(
        "SELECT kind,payload_json FROM catalog_assembly_operations WHERE id=?",
      )
      .bind(context.id)
      .first<{ kind: string; payload_json: string }>();
    if (!old) return false;
    if (
      old.kind !== kind ||
      JSON.stringify(JSON.parse(old.payload_json).request) !==
        JSON.stringify(request)
    )
      throw new CatalogItemRejected("提交标识已使用", 409);
    return true;
  }
  async function record(
    kind: string,
    series: string,
    expected: Token,
    payload: Record<string, unknown>,
    context: OperationContext,
    generation: number | null = null,
  ) {
    authorize();
    const old = await database
      .prepare(
        "SELECT kind,payload_json FROM catalog_assembly_operations WHERE id=?",
      )
      .bind(context.id)
      .first<{ kind: string; payload_json: string }>();
    if (old) {
      if (old.kind !== kind || old.payload_json !== JSON.stringify(payload))
        throw new CatalogItemRejected("提交标识已使用", 409);
      return;
    }
    try {
      await database
        .prepare(
          `INSERT INTO catalog_assembly_operations(id,kind,hose_series,expected_sequence,expected_relation_version,expected_generation,payload_json,actor_id,ip_address,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          context.id,
          kind,
          series,
          expected.sequence,
          expected.relationVersion,
          generation,
          JSON.stringify(payload),
          actor.id,
          context.ipAddress,
          new Date().toISOString(),
        )
        .run();
    } catch (error) {
      if (payload.request && (await replay(context, kind, payload.request)))
        return;
      const message = error instanceof Error ? error.message : "";
      if (message.includes("catalog_assembly_relation_identifier"))
        throw new CatalogItemRejected("关系编号已被其他三件套使用", 409);
      if (message.includes("inputs changed"))
        throw new CatalogItemRejected("相关总成输入已变化，请重新更新", 409);
      throw error;
    }
  }
  async function inputs(series: string) {
    const current = await state();
    async function products(table: string, type: string, onlySeries = false) {
      return (
        await database
          .prepare(
            `SELECT p.* FROM ${table} p JOIN catalog_runtime_skus s ON s.import_id=p.import_id AND s.sku=p.sku
        WHERE p.import_id=? AND s.product_type=? AND s.catalog_publication_status='Published' AND s.rfq_eligibility='Eligible'
        AND s.supply_availability='available_for_quote' ${onlySeries ? "AND p.hose_series=?" : ""}`,
          )
          .bind(current.importId, type, ...(onlySeries ? [series] : []))
          .all<Product>()
      ).results;
    }
    const [
      hoses,
      ends,
      ferrules,
      legacy,
      overrides,
      revisions,
      pendingSources,
    ] = await Promise.all([
      products("catalog_runtime_hose_variants", "hose", true),
      products("catalog_runtime_hose_ends", "hose_end"),
      products("catalog_runtime_ferrules", "ferrule"),
      database
        .prepare(
          `SELECT c.*,h.hose_series FROM catalog_runtime_compatibilities c JOIN catalog_runtime_hose_variants h ON h.import_id=c.import_id AND h.sku=c.hose_sku WHERE c.import_id=? AND h.hose_series=?`,
        )
        .bind(current.importId, series)
        .all<AssemblyEndpoint>(),
      database
        .prepare(
          "SELECT o.payload_json FROM catalog_assembly_relation_overrides o JOIN catalog_runtime_hose_variants h ON h.sku=json_extract(o.payload_json,'$.hose_sku') WHERE h.import_id=? AND h.hose_series=?",
        )
        .bind(current.importId, series)
        .all<{ payload_json: string }>(),
      database
        .prepare(
          "SELECT kind,product_type,code,revision_id FROM catalog_item_current",
        )
        .all<{
          kind: string;
          product_type: string;
          code: string;
          revision_id: string;
        }>(),
      database
        .prepare(
          "SELECT source_json FROM catalog_pending_relation_sources WHERE status='pending'",
        )
        .all<{ source_json: string }>(),
    ]);
    const known = new Map<string, AssemblyEndpoint>(
      legacy.results.map((e) => [
        triple(e),
        { ...e, source: "legacy" as const },
      ]),
    );
    for (const row of overrides.results) {
      const e = JSON.parse(row.payload_json) as AssemblyEndpoint;
      known.set(triple(e), e);
    }
    const pendingTriples = new Set(
      pendingSources.results.map((row) => {
        const v = JSON.parse(row.source_json).values ?? {};
        return JSON.stringify([v.hoseSku, v.hoseEndSku, v.ferruleSku]);
      }),
    );
    const endpoints: AssemblyEndpoint[] = [];
    const matched: AssemblyEndpoint[] = [];
    for (const h of hoses)
      for (const e of ends)
        for (const f of ferrules) {
          if (
            f.ferrule_series !== h.hose_series ||
            f.skive_requirement !== h.skive_requirement ||
            !assemblyDashMatches(
              String(h.dash ?? ""),
              String(e.hose_tail_dash ?? ""),
              String(f.hose_tail_dash ?? ""),
            )
          )
            continue;
          const identity = JSON.stringify([h.sku, e.sku, f.sku]);
          const endpoint = known.get(identity) ?? {
            id: `item-auto:${identity}`,
            compatibility_id: `AUTO:${h.sku}:${e.sku}:${f.sku}`,
            hose_sku: h.sku,
            hose_end_sku: e.sku,
            ferrule_sku: f.sku,
            hose_series: series,
            source: "automatic" as const,
            catalog_publication_status: "Published",
            rfq_eligibility: "Eligible",
            technical_data_status: "Pending",
            qualification_status: "Not Tested",
            production_approval_status: "not_approved",
            reference_system: "Automatic catalog compatibility rule",
            skive_requirement: h.skive_requirement,
          };
          matched.push({ ...endpoint, hose_series: series });
          if (
            eligible(endpoint) &&
            (known.has(identity) || !pendingTriples.has(identity))
          )
            endpoints.push({ ...endpoint, hose_series: series });
        }
    const referenced = new Set([
      ...hoses.map((h) => h.sku),
      ...matched.flatMap((e) => [e.hose_sku, e.hose_end_sku, e.ferrule_sku]),
    ]);
    const seriesCodes = new Set([
      series,
      ...ends
        .filter((e) => referenced.has(e.sku))
        .map((e) => String(e.fitting_series)),
      ...ferrules
        .filter((e) => referenced.has(e.sku))
        .map((e) => String(e.ferrule_series)),
    ]);
    return {
      endpoints,
      matched,
      baselineReleaseId: current.baseline_release_id,
      revisions: revisions.results.filter((r) =>
        r.kind === "sku" ? referenced.has(r.code) : seriesCodes.has(r.code),
      ),
    };
  }
  async function all(
    options: {
      filters?: Record<string, string>;
      limit?: number;
      offset?: number;
      identities?: string[];
    } = {},
  ) {
    const current = await state();
    const f = options.filters ?? {};
    const rows = await database
      .prepare(
        `SELECT c.*,m.operation_id AS manual_id,s.generation_id,
      COALESCE(x.disabled,0) AS disabled,
      EXISTS (SELECT 1 FROM catalog_assembly_pending_series p WHERE p.hose_series=c.hose_series) AS pending,
      EXISTS (SELECT 1 FROM catalog_assembly_relation_overrides o WHERE
        json_extract(o.payload_json,'$.hose_sku')=c.hose_sku AND
        (json_extract(o.payload_json,'$.hose_end_sku')=c.end_a_hose_end_sku AND json_extract(o.payload_json,'$.ferrule_sku')=c.end_a_ferrule_sku
        OR json_extract(o.payload_json,'$.hose_end_sku')=c.end_b_hose_end_sku AND json_extract(o.payload_json,'$.ferrule_sku')=c.end_b_ferrule_sku)) AS imported
      FROM catalog_runtime_assembly_combinations c
      LEFT JOIN catalog_assembly_manual m ON m.identity=c.identity
      LEFT JOIN catalog_assembly_managed_series s ON s.hose_series=c.hose_series
      LEFT JOIN catalog_assembly_exclusions x ON x.identity=c.identity
      WHERE c.release_id=? AND (?='' OR c.end_a_hose_end_sku=?) AND (?='' OR c.end_b_hose_end_sku=?)
      AND (?='' OR c.hose_series=?) AND (?='' OR instr(lower(c.identity),lower(?))>0)
      AND (?='' OR COALESCE(x.disabled,0)=?)
      AND (?='' OR EXISTS (SELECT 1 FROM catalog_assembly_pending_series p WHERE p.hose_series=c.hose_series)=?)
      AND (? IS NULL OR c.identity IN (SELECT value FROM json_each(?)))
      ORDER BY c.hose_series,c.identity LIMIT ? OFFSET ?`,
      )
      .bind(
        current.baseline_release_id,
        f.endA ?? "",
        f.endA ?? "",
        f.endB ?? "",
        f.endB ?? "",
        f.series ?? "",
        f.series ?? "",
        f.q ?? "",
        f.q ?? "",
        f.enabled ?? "",
        f.enabled === "disabled" ? 1 : 0,
        f.ready ?? "",
        f.ready === "pending" ? 1 : 0,
        options.identities ? JSON.stringify(options.identities) : null,
        options.identities ? JSON.stringify(options.identities) : null,
        options.limit ?? -1,
        options.offset ?? 0,
      )
      .all<{
        identity: string;
        hose_series: string;
        hose_sku: string;
        end_a_hose_end_sku: string;
        end_a_ferrule_sku: string;
        end_b_hose_end_sku: string;
        end_b_ferrule_sku: string;
        end_a_compatibility_id: string;
        end_b_compatibility_id: string;
        manual_id: string | null;
        generation_id: string | null;
        disabled: number;
        pending: number;
        imported: number;
      }>();
    return rows.results.map((c) => ({
      identity: c.identity,
      hoseSeries: c.hose_series,
      hoseSku: c.hose_sku,
      endAHoseEndSku: c.end_a_hose_end_sku,
      endAFerruleSku: c.end_a_ferrule_sku,
      endBHoseEndSku: c.end_b_hose_end_sku,
      endBFerruleSku: c.end_b_ferrule_sku,
      endACompatibilityId: c.end_a_compatibility_id,
      endBCompatibilityId: c.end_b_compatibility_id,
      source: (c.manual_id
        ? "manual"
        : c.imported
          ? "import"
          : c.generation_id
            ? "automatic"
            : "legacy") as ManagedCombination["source"],
      generationId: c.generation_id,
      disabled: c.disabled === 1,
      pending: c.pending === 1,
    }));
  }
  async function filterOptions() {
    const current = await state();
    return (
      await database
        .prepare(
          `SELECT DISTINCT 'series' AS kind,hose_series AS code FROM catalog_runtime_hose_variants WHERE import_id=?
      UNION SELECT 'end',sku FROM catalog_runtime_hose_ends WHERE import_id=? ORDER BY code`,
        )
        .bind(current.importId, current.importId)
        .all<{ kind: string; code: string }>()
    ).results;
  }
  async function sources() {
    return (
      await database
        .prepare(
          "SELECT * FROM catalog_pending_relation_sources ORDER BY created_at DESC,id",
        )
        .all<SourceRow>()
    ).results;
  }
  async function history(series?: string) {
    return (
      await database
        .prepare(
          `SELECT id,kind,hose_series,actor_id,occurred_at,
          CASE WHEN ? IS NOT NULL THEN payload_json ELSE json_object('reason',json_extract(payload_json,'$.reason'),'identities',json_extract(payload_json,'$.identities')) END AS payload_json
          FROM catalog_assembly_operations WHERE ? IS NULL OR hose_series=? OR hose_series=''
          ORDER BY occurred_at DESC,id`,
        )
        .bind(series ?? null, series ?? null, series ?? null)
        .all<{
          id: string;
          kind: string;
          hose_series: string;
          payload_json: string;
          actor_id: string;
          occurred_at: string;
        }>()
    ).results;
  }
  return {
    all,
    filterOptions,
    pending,
    sources,
    history,
    inputs,
    async update(context: OperationContext) {
      authorize();
      const seriesList = await pending();
      const results: { series: string; success: boolean; reason: string }[] =
        [];
      for (const series of seriesList) {
        const expected = await token(series);
        const operation = { ...context, id: `${context.id}:${series}` };
        try {
          const request = { series };
          if (await replay(operation, "generate", request)) {
            results.push({
              series,
              success: true,
              reason: "该提交已完成；后续变更请重新发起更新",
            });
            continue;
          }
          const { matched: _matched, ...basis } = await inputs(series);
          const counts = new Map<string, number>();
          for (const e of basis.endpoints)
            counts.set(e.hose_sku, (counts.get(e.hose_sku) ?? 0) + 1);
          const combinationCount = [...counts.values()].reduce(
            (sum, count) => sum + count * count,
            0,
          );
          await record(
            "generate",
            series,
            expected,
            { ...basis, combinationCount, request },
            operation,
          );
          results.push({
            series,
            success: true,
            reason: `已更新 ${combinationCount} 个组合`,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "更新失败";
          await record(
            "failure",
            series,
            expected,
            { reason },
            {
              ...operation,
              id: `${operation.id}:failure:${crypto.randomUUID()}`,
            },
          );
          results.push({ series, success: false, reason });
        }
      }
      return results;
    },
    async add(parts: AssemblyParts, context: OperationContext) {
      authorize();
      const identity = assemblyIdentity(parts);
      const request = { identity };
      if (await replay(context, "manual", request)) return;
      const current = await state();
      if (
        (await all({ identities: [identity] })).some(
          (c) => c.identity === identity && c.source === "manual",
        )
      )
        throw new CatalogItemRejected("手动组合已存在", 409);
      const hose = await database
        .prepare(
          "SELECT hose_series FROM catalog_runtime_hose_variants WHERE import_id=? AND sku=?",
        )
        .bind(current.importId, parts.hoseSku)
        .first<{ hose_series: string }>();
      if (!hose) throw new CatalogItemRejected("胶管不存在或未上线");
      const expected = await token(hose.hose_series);
      const basis = await inputs(hose.hose_series);
      const combination = deriveManagedCombinations(basis.endpoints).find(
        (c) => c.identity === identity,
      );
      if (!combination)
        throw new CatalogItemRejected("部件引用或既有兼容资格无效");
      await record(
        "manual",
        hose.hose_series,
        expected,
        {
          request,
          combination: { ...combination, source: "manual" },
          revisions: basis.revisions,
        },
        context,
        current.generation,
      );
    },
    async setEnabled(
      identities: string[],
      enabled: boolean,
      reason: string,
      context: OperationContext,
    ) {
      authorize();
      if (!identities.length || !reason.trim())
        throw new CatalogItemRejected("请选择组合并填写原因");
      const request = {
        identities: [...new Set(identities)].sort(),
        reason: reason.trim(),
      };
      if (await replay(context, enabled ? "enable" : "disable", request))
        return;
      const current = await state();
      const rows = await all({ identities });
      for (const identity of new Set(identities)) {
        const combination = rows.find((c) => c.identity === identity);
        if (!combination) throw new CatalogItemRejected("组合不存在");
        if (enabled) {
          const valid = deriveManagedCombinations(
            (await inputs(combination.hoseSeries)).endpoints,
          ).some((c) => c.identity === identity);
          if (combination.pending || !valid)
            throw new CatalogItemRejected("组合待更新或部件无效，不能启用");
        }
      }
      // One command commits all explicitly selected identities atomically.
      await record(
        enabled ? "enable" : "disable",
        "",
        await token(""),
        { identities: request.identities, reason: request.reason, request },
        context,
        current.generation,
      );
    },
    async processSource(
      sourceId: string,
      disposition: "apply" | "reject" | "delete",
      reason: string,
      context: OperationContext,
    ) {
      authorize();
      const request = { sourceId, reason: reason.trim() };
      if (await replay(context, disposition, request)) return;
      const current = await state();
      const source = await database
        .prepare("SELECT * FROM catalog_pending_relation_sources WHERE id=?")
        .bind(sourceId)
        .first<SourceRow>();
      if (!source || source.status !== "pending")
        throw new CatalogItemRejected("关系源不在待处理状态", 409);
      if (!reason.trim()) throw new CatalogItemRejected("请填写处理原因");
      const original = JSON.parse(source.source_json) as {
        values: Record<string, CatalogWorkbookCell>;
      };
      const values = original.values;
      if (disposition !== "apply") {
        const dependency = await database
          .prepare(
            "SELECT hose_series FROM catalog_runtime_hose_variants WHERE import_id=? AND sku=?",
          )
          .bind(current.importId, String(values?.hoseSku ?? ""))
          .first<{ hose_series: string }>();
        const series = dependency?.hose_series ?? "";
        return record(
          disposition,
          series,
          await token(series),
          { sourceId, reason, request },
          context,
          current.generation,
        );
      }
      const issues = validateCatalogWorksheetRecord(
        "04_兼容压接",
        original.values,
      ).filter((i) => i.severity === "error");
      if (issues.length)
        throw new CatalogItemRejected(
          issues.map((i) => `${i.field}: ${i.message}`).join("；"),
        );
      const hose = await database
        .prepare(
          "SELECT hose_series FROM catalog_runtime_hose_variants WHERE import_id=? AND sku=?",
        )
        .bind(current.importId, values.hoseSku)
        .first<{ hose_series: string }>();
      if (!hose) throw new CatalogItemRejected("依赖胶管未上线");
      const expected = await token(hose.hose_series);
      const basis = await inputs(hose.hose_series);
      const candidate = basis.matched.find(
        (e) =>
          e.hose_sku === values.hoseSku &&
          e.hose_end_sku === values.hoseEndSku &&
          e.ferrule_sku === values.ferruleSku,
      );
      if (!candidate)
        throw new CatalogItemRejected("依赖产品未上线或不符合现有匹配规则");
      const endpoint = {
        ...Object.fromEntries(
          Object.entries(values).map(([k, v]) => [
            k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
            v,
          ]),
        ),
        id: `relation:${sourceId}`,
        compatibility_id: String(values.compatibilityId),
        hose_sku: String(values.hoseSku),
        hose_end_sku: String(values.hoseEndSku),
        ferrule_sku: String(values.ferruleSku),
        source: "import",
        hose_series: hose.hose_series,
        production_approval_status: "not_approved",
      } as AssemblyEndpoint;
      if (!eligible(endpoint))
        throw new CatalogItemRejected(
          "关系必须为已发布且可询价；来源不作为生产验证证据",
        );
      const conflict = await database
        .prepare(
          "SELECT hose_sku,hose_end_sku,ferrule_sku FROM catalog_runtime_compatibilities WHERE import_id=? AND compatibility_id=?",
        )
        .bind(current.importId, endpoint.compatibility_id)
        .first<AssemblyEndpoint>();
      if (conflict && triple(conflict) !== triple(endpoint))
        throw new CatalogItemRejected("关系编号已被其他三件套使用");
      await record(
        "apply",
        hose.hose_series,
        expected,
        {
          sourceId,
          reason,
          request,
          endpoint,
          endpointIdentity: triple(endpoint),
          revisions: basis.revisions,
        },
        context,
        current.generation,
      );
    },
  };
}
