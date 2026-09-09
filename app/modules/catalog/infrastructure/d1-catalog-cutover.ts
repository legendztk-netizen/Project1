import { createD1CatalogItemRepository } from "./d1-catalog-item-repository";
import {
  canonicalJson,
  draftDifference,
  releaseProducts,
  type LegacyRow,
} from "../domain/catalog-cutover";
import {
  CatalogItemRejected,
  itemCode,
  type CatalogItemCommand,
} from "../domain/catalog-item-publication";
import { itemSeriesCode } from "./d1-additional-catalog-items";

const productTables = [
  "catalog_skus",
  "catalog_hose_variants",
  "catalog_hose_ends",
  "catalog_ferrules",
  "catalog_adapters",
  "catalog_adapter_families",
  "catalog_quick_couplers",
  "catalog_hose_series",
  "catalog_hose_end_series",
  "catalog_series_commercial_rules",
  "catalog_sku_price_packaging",
  "catalog_sales_offers",
  "catalog_product_main_images",
];
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
interface Run {
  id: string;
  expected_epoch: number;
  active_release_id: string;
  fingerprint: string;
  report_json: string;
  status: string;
  actor_id: string;
  created_at: string;
}
interface RecordEntry {
  key: string;
  kind: "baseline" | "request" | "relation" | "retained";
  value: Record<string, unknown>;
  targetId: string | null;
}
export function createD1CatalogCutover(
  db: D1Database,
  actor: { id: string; accountType: string; catalogPermission?: string },
) {
  function authorize() {
    if (actor.accountType !== "owner" || actor.catalogPermission === "view")
      throw new CatalogItemRejected("仅主账号可执行目录切换", 403);
  }
  async function control() {
    return (await db
      .prepare("SELECT * FROM catalog_cutover_control WHERE singleton=1")
      .first<{ epoch: number; frozen: number; committed: number }>())!;
  }
  async function run(id: string) {
    const r = await db
      .prepare("SELECT * FROM catalog_cutover_runs WHERE id=?")
      .bind(id)
      .first<Run>();
    if (!r) throw new CatalogItemRejected("迁移盘点不存在");
    return r;
  }
  async function releaseTables(importId: string) {
    const tables: Record<string, LegacyRow[]> = {};
    for (const table of productTables)
      tables[table] = (
        await db
          .prepare(`SELECT * FROM ${table} WHERE import_id=? ORDER BY id`)
          .bind(importId)
          .all<LegacyRow>()
      ).results;
    tables.catalog_media_versions = (
      await db
        .prepare("SELECT * FROM catalog_media_versions ORDER BY id")
        .all<LegacyRow>()
    ).results;
    return tables;
  }
  async function inventory(id: string) {
    authorize();
    const existing = await db
      .prepare("SELECT * FROM catalog_cutover_runs WHERE id=?")
      .bind(id)
      .first<Run>();
    if (existing) return existing;
    const before = await control();
    if (before.frozen || before.committed)
      throw new CatalogItemRejected("迁移已冻结或完成");
    const active = await db
      .prepare(
        "SELECT r.* FROM catalog_releases r JOIN catalog_active_release a ON a.release_id=r.id",
      )
      .first<LegacyRow>();
    if (!active) throw new CatalogItemRejected("缺少 Active 目录");
    const releases = (
      await db
        .prepare("SELECT * FROM catalog_releases ORDER BY id")
        .all<LegacyRow>()
    ).results;
    const activeProducts = releaseProducts(
      await releaseTables(String(active.source_import_id)),
    );
    const activeByKey = new Map(activeProducts.map((p) => [p.key, p]));
    const records: RecordEntry[] = [];
    for (const product of activeProducts)
      records.push({
        key: `${active.id}:${product.key}`,
        kind: "baseline",
        value: { ...product, releaseId: active.id },
        targetId: `cutover-revision:${active.id}:${product.key}`,
      });
    // Historical creation baselines are not inferred from today's impact analysis.
    // Missing lineage is deliberately reviewable, rather than silently treating Active as the baseline.
    for (const release of releases.filter((r) => r.status === "draft")) {
      const lineage = await db
        .prepare(
          "SELECT b.baseline_release_id,r.source_import_id FROM catalog_release_creation_baselines b LEFT JOIN catalog_releases r ON r.id=b.baseline_release_id WHERE b.release_id=?",
        )
        .bind(release.id as string)
        .first<{
          baseline_release_id: string | null;
          source_import_id: string | null;
        }>();
      const baselineProducts = lineage?.source_import_id
        ? releaseProducts(await releaseTables(lineage.source_import_id))
        : [];
      const baselineByKey = new Map(baselineProducts.map((p) => [p.key, p]));
      const draft = releaseProducts(
        await releaseTables(String(release.source_import_id)),
      );
      const draftByKey = new Map(draft.map((p) => [p.key, p]));
      for (const key of new Set([
        ...draftByKey.keys(),
        ...activeByKey.keys(),
      ])) {
        const p = draftByKey.get(key),
          a = activeByKey.get(key),
          b = baselineByKey.get(key);
        const disposition = draftDifference(
          b ? { payload: b.payload, targetState: b.targetState } : null,
          p ? { payload: p.payload, targetState: p.targetState } : null,
          a ? { payload: a.payload, targetState: a.targetState } : null,
          !!lineage,
        );
        if (disposition === "already_current" || disposition === "inherited") {
          records.push({
            key: `${release.id}:${key}`,
            kind: "retained",
            targetId: activeByKey.has(key)
              ? `cutover-revision:${active.id}:${key}`
              : null,
            value: {
              releaseId: release.id,
              disposition,
              original: p?.original ?? null,
              baseline: b ?? null,
              active: a ?? null,
            },
          });
          continue;
        }
        const product = p ?? a!;
        const requestId = `cutover-request:${release.id}:${key}`;
        const command: CatalogItemCommand = {
          commandId: requestId,
          actorId: actor.id,
          ipAddress: "migration",
          payload: product.payload,
          targetState: product.targetState,
          mode: a ? "edit" : "create",
          baselineRevisionId: null,
          source: {
            channel: "migration",
            batchId: `cutover-batch:${release.id}`,
          },
        };
        const issues =
          disposition === "changed" || disposition === "added"
            ? []
            : [
                p
                  ? "迁移待审核：缺少可证明的 Draft 创建基线，请确认变更意图并修正后提交"
                  : "迁移待处理：Draft 缺行不能证明删除意图；保留 Active 原内容，需明确处理",
              ];
        if (!issues.length) {
          try {
            await createD1CatalogItemRepository(db).validateRequest(command);
          } catch (error) {
            issues.push(
              error instanceof Error ? error.message : "旧 Draft 数据需要修正",
            );
          }
        }
        records.push({
          key: `${release.id}:${key}`,
          kind: "request",
          targetId: requestId,
          value: {
            command,
            issues,
            original: product.original,
            releaseId: release.id,
            baseline: b ?? null,
            active: a ?? null,
            disposition,
            missingFromDraft: !p,
          },
        });
      }
      const relations = (
        await db
          .prepare(
            "SELECT * FROM catalog_compatibilities WHERE import_id=? ORDER BY id",
          )
          .bind(release.source_import_id as string)
          .all<LegacyRow>()
      ).results;
      const activeRelations = (
        await db
          .prepare(
            "SELECT * FROM catalog_compatibilities WHERE import_id=? ORDER BY id",
          )
          .bind(active.source_import_id as string)
          .all<LegacyRow>()
      ).results;
      const baselineRelations = lineage?.source_import_id
        ? (
            await db
              .prepare(
                "SELECT * FROM catalog_compatibilities WHERE import_id=? ORDER BY id",
              )
              .bind(lineage.source_import_id)
              .all<LegacyRow>()
          ).results
        : [];
      const clean = (r: LegacyRow | undefined) =>
        r
          ? Object.fromEntries(
              Object.entries(r).filter(
                ([k]) => !["id", "import_id"].includes(k),
              ),
            )
          : null;
      const drafts = new Map(relations.map((r) => [r.compatibility_id, r])),
        bases = new Map(baselineRelations.map((r) => [r.compatibility_id, r])),
        actives = new Map(activeRelations.map((r) => [r.compatibility_id, r]));
      for (const key of new Set([
        ...drafts.keys(),
        ...bases.keys(),
        ...actives.keys(),
      ])) {
        const d = drafts.get(key),
          b = bases.get(key),
          a = actives.get(key);
        const disposition = draftDifference(
          clean(b),
          clean(d),
          clean(a),
          !!lineage,
        );
        if (disposition === "inherited" || disposition === "already_current") {
          records.push({
            key: `${release.id}:relation:${key}`,
            kind: "retained",
            targetId: a ? String(a.id) : null,
            value: {
              releaseId: release.id,
              disposition,
              original: d ?? null,
              baseline: b ?? null,
              active: a ?? null,
            },
          });
          continue;
        }
        const relation = d ?? b ?? a!;
        records.push({
          key: `${release.id}:relation:${key}`,
          kind: "relation",
          targetId: `cutover-relation:${release.id}:${key}`,
          value: {
            releaseId: release.id,
            relation,
            baseline: b ?? null,
            active: a ?? null,
            disposition,
            issues: !d
              ? ["Draft 缺行不构成删除依据；请明确停用相关组合或保留关系"]
              : disposition === "ambiguous"
                ? ["迁移待处理：缺少 Draft 创建基线，请核对关系意图"]
                : [],
            missingFromDraft: !d,
          },
        });
      }
    }
    const tableNames = (
      await db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'catalog_%' OR name LIKE 'configurator_%') AND name NOT LIKE 'catalog_cutover_%' ORDER BY name",
        )
        .all<{ name: string }>()
    ).results;
    const counts: Record<string, { count: number; hash: string }> = {};
    for (const { name } of tableNames) {
      let count = 0,
        digest = await hash([]);
      for (;;) {
        const rows = (
          await db
            .prepare(
              `SELECT * FROM "${name}" ORDER BY rowid LIMIT 1000 OFFSET ?`,
            )
            .bind(count)
            .all<LegacyRow>()
        ).results;
        if (!rows.length) break;
        digest = await hash({ previous: digest, rows });
        count += rows.length;
      }
      counts[name] = { count, hash: digest };
    }
    const after = await control();
    if (before.epoch !== after.epoch)
      throw new CatalogItemRejected("盘点期间目录发生变化，请重新盘点", 409);
    const report = {
      activeReleaseId: active.id,
      epoch: before.epoch,
      releases: releases.map((r) => ({
        id: r.id,
        status: r.status,
        scope:
          r.id === active.id
            ? "baseline"
            : r.status === "draft"
              ? "pending_review"
              : "retained_history",
      })),
      counts,
      baselineProducts: activeProducts.length,
      retained: records.filter((r) => r.kind === "retained").length,
      requests: records.filter((r) => r.kind === "request").length,
      relations: records.filter((r) => r.kind === "relation").length,
      baselinePolicy: "Missing creation baselines require explicit review",
      readMapping:
        "Original releases, assembly rules, service rules, images and historical snapshots remain immutable; existing item edits keep priority",
    };
    const fingerprint = await hash(report),
      now = new Date().toISOString();
    const statements = [
      db
        .prepare(
          "INSERT INTO catalog_cutover_runs(id,expected_epoch,active_release_id,fingerprint,report_json,status,actor_id,created_at) VALUES(?,?,?,?,?,'inventoried',?,?)",
        )
        .bind(
          id,
          before.epoch,
          active.id as string,
          fingerprint,
          JSON.stringify(report),
          actor.id,
          now,
        ),
    ];
    // Evidence is staged before freezing. Incomplete staging is not eligible for commit.
    for (const r of records)
      statements.push(
        db
          .prepare(
            "INSERT INTO catalog_cutover_records(source_key,run_id,record_kind,payload_json,content_hash,target_id) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            `${id}:${r.key}`,
            id,
            r.kind,
            JSON.stringify(r.value),
            await hash(r.value),
            r.targetId,
          ),
      );
    await db.batch(statements);
    return run(id);
  }
  async function freeze(id: string) {
    authorize();
    const r = await run(id);
    if (r.status === "frozen" || r.status === "committed") return r;
    await db
      .prepare(
        "UPDATE catalog_cutover_runs SET status='frozen' WHERE id=? AND status='inventoried'",
      )
      .bind(id)
      .run();
    return run(id);
  }
  async function cancel(id: string) {
    authorize();
    await db
      .prepare(
        "UPDATE catalog_cutover_runs SET status='cancelled' WHERE id=? AND status IN('inventoried','frozen')",
      )
      .bind(id)
      .run();
    return run(id);
  }
  async function commit(id: string) {
    authorize();
    const r = await run(id);
    if (r.status === "committed") return r;
    if (r.status !== "frozen")
      throw new CatalogItemRejected("请先冻结并核对盘点");
    const records = (
      await db
        .prepare(
          "SELECT * FROM catalog_cutover_records WHERE run_id=? ORDER BY source_key",
        )
        .bind(id)
        .all<{ record_kind: string; payload_json: string; target_id: string }>()
    ).results;
    const report = JSON.parse(r.report_json);
    if (
      records.length !==
      report.baselineProducts +
        report.requests +
        report.relations +
        report.retained
    )
      throw new CatalogItemRejected("迁移暂存记录不完整");
    const now = new Date().toISOString();
    const statements = [
      db
        .prepare(
          "UPDATE catalog_cutover_runs SET status='committing' WHERE id=? AND status='frozen'",
        )
        .bind(id),
      db
        .prepare(
          "UPDATE catalog_item_publication_state SET mode='items',baseline_release_id=? WHERE singleton=1",
        )
        .bind(r.active_release_id),
    ];
    const batchIds = new Set<string>();
    for (const row of records) {
      const value = JSON.parse(row.payload_json);
      if (row.record_kind === "retained") continue;
      if (row.record_kind === "baseline") {
        const p = value.payload as CatalogItemCommand["payload"],
          code = itemCode(p),
          entityId = `cutover-entity:${p.kind}:${p.productType}:${code}`;
        statements.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO catalog_product_entities(id,kind,product_type,code) VALUES(?,?,?,?)",
            )
            .bind(entityId, p.kind, p.productType, code),
        );
        statements.push(
          db
            .prepare(
              `INSERT INTO catalog_product_revisions(id,entity_id,target_state,payload_json,media_version_id,source_json,affected_series_json,command_id,command_hash,expected_generation,actor_id,ip_address,occurred_at)
        SELECT ?,e.id,?,?,?,?, '[]',?,?,0,?,'migration',? FROM catalog_product_entities e WHERE e.kind=? AND e.product_type=? AND e.code=?`,
            )
            .bind(
              row.target_id,
              value.targetState,
              JSON.stringify(p),
              p.mediaVersionId,
              JSON.stringify({
                channel: "migration",
                bootstrap: true,
                runId: id,
                legacyReadMapping: r.active_release_id,
                original: value.original,
              }),
              row.target_id,
              await hash(value),
              actor.id,
              now,
              p.kind,
              p.productType,
              code,
            ),
        );
        continue;
      }
      const batchId = `cutover-batch:${value.releaseId}`;
      if (!batchIds.has(batchId)) {
        batchIds.add(batchId);
        statements.push(
          db
            .prepare(
              "INSERT INTO catalog_item_import_batches(id,file_name,file_size_bytes,original_json,issues_json,created_by,created_at) VALUES(?,?,0,?,'[]',?,?)",
            )
            .bind(
              batchId,
              `旧 Draft ${value.releaseId}`,
              JSON.stringify({ releaseId: value.releaseId, runId: id }),
              actor.id,
              now,
            ),
        );
      }
      if (row.record_kind === "request") {
        const command = value.command as CatalogItemCommand;
        const parent = `cutover-request:${value.releaseId}:series:${command.payload.productType}:${itemSeriesCode(command.payload)}`;
        const dependencies =
          command.payload.kind === "sku" &&
          records.some((x) => x.target_id === parent)
            ? [parent]
            : [];
        statements.push(
          db
            .prepare(
              "INSERT INTO catalog_product_change_requests(id,payload_json,original_json,source_json,dependencies_json,target_state,created_by,created_at,issues_json,batch_id,baseline_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            )
            .bind(
              row.target_id,
              JSON.stringify(command),
              JSON.stringify([
                {
                  sheet: "migration",
                  row: 0,
                  values: value.original,
                  cells: [],
                  migration: value,
                },
              ]),
              JSON.stringify(command.source),
              JSON.stringify(dependencies),
              command.targetState,
              actor.id,
              now,
              JSON.stringify(value.issues),
              batchId,
              JSON.stringify(value.baseline?.payload ?? null),
            ),
        );
      } else {
        const relation = value.relation as LegacyRow;
        const values = Object.fromEntries(
          Object.entries(relation).map(([k, v]) => [
            k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()),
            v,
          ]),
        );
        statements.push(
          db
            .prepare(
              "INSERT INTO catalog_pending_relation_sources(id,batch_id,source_json,issues_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              row.target_id,
              batchId,
              JSON.stringify({
                sheet: "04_兼容压接",
                row: 0,
                values,
                cells: [],
                migration: value,
              }),
              JSON.stringify(value.issues),
              actor.id,
              now,
            ),
        );
      }
    }
    statements.push(
      db.prepare(
        "UPDATE catalog_item_publication_state SET generation=generation+1 WHERE singleton=1",
      ),
    );
    statements.push(
      db
        .prepare(
          "UPDATE catalog_cutover_runs SET status='committed' WHERE id=? AND status='committing'",
        )
        .bind(id),
    );
    await db.batch(statements);
    return run(id);
  }
  return {
    inventory,
    freeze,
    cancel,
    commit,
    run,
    async history() {
      authorize();
      return (
        await db
          .prepare(
            "SELECT * FROM catalog_cutover_runs ORDER BY created_at DESC",
          )
          .all<Run>()
      ).results;
    },
  };
}
