import {
  ArrowLeft,
  Check,
  Filter,
  GitBranch,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-review";
import {
  AssemblyRegenerationRejected,
  regenerateDerivedAssemblyData,
} from "../../catalog/domain/catalog-assembly-regeneration";
import {
  applyDraftSupplyAvailabilityChange,
  previewDraftSupplyAvailabilityChange,
  supplyAvailabilityValues,
  type DraftAvailabilityChangePreview,
  type DraftProductSelector,
  type SupplyAvailability,
} from "../../catalog/domain/catalog-draft-availability";
import {
  CatalogPublicationRejected,
  publishCatalogRelease,
  type CatalogPublicationFinding,
  type CatalogPublicationPreview,
  type CatalogPublicationSummary,
} from "../../catalog/domain/catalog-publication";
import { createD1CatalogDraftReviewRepository } from "../../catalog/infrastructure/d1-catalog-draft-review-repository";
import {
  createD1CatalogAssemblyImpactRepository,
  type CatalogAssemblyImpact,
} from "../../catalog/infrastructure/d1-catalog-assembly-impact-repository";
import { createD1CatalogAssemblyRegenerationRepository } from "../../catalog/infrastructure/d1-catalog-assembly-regeneration-repository";
import { expandDraftCatalogCompatibilities } from "../../catalog/infrastructure/d1-catalog-compatibility-expansion-repository";
import { createD1CatalogPublicationRepository } from "../../catalog/infrastructure/d1-catalog-publication-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";

const availabilityLabels: Record<SupplyAvailability, string> = {
  available_for_quote: "可询价",
  discontinued: "已停产",
  temporarily_unavailable: "暂不可用",
};

export function meta() {
  return [{ title: "产品审核与发布 | Admin Backoffice" }];
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function selectorFromForm(form: FormData): DraftProductSelector {
  const mode = textValue(form, "selectorMode");
  if (mode === "worksheet") {
    return { mode, sourceWorksheet: textValue(form, "sourceWorksheet") };
  }
  if (mode === "hose_series") {
    return { hoseSeries: textValue(form, "hoseSeries"), mode };
  }
  if (mode === "selected") {
    return {
      mode,
      skus: form
        .getAll("selectedSku")
        .filter((value): value is string => typeof value === "string"),
    };
  }
  throw new Error("请选择批量修改范围。");
}

function targetFromForm(form: FormData) {
  const value = textValue(form, "target");
  if (!supplyAvailabilityValues.includes(value as SupplyAvailability)) {
    throw new Error("请选择有效的供应状态。");
  }
  return value as SupplyAvailability;
}

function requestAuditContext(request: Request) {
  return {
    ipAddress: request.headers.get("cf-connecting-ip") ?? "local",
    requestCorrelationId:
      request.headers.get("cf-ray") ??
      request.headers.get("x-request-id") ??
      `local-${crypto.randomUUID()}`,
  };
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const url = new URL(request.url);
  const reviewRepository = createD1CatalogDraftReviewRepository(env.DB);
  const publicationRepository = createD1CatalogPublicationRepository(env.DB);
  const requestedReleaseId = url.searchParams.get("release");
  const auditContext = requestAuditContext(request);
  let [review, activeRelease, currentDraftRelease] = await Promise.all([
    reviewRepository.findCatalogReview(requestedReleaseId, {
      hoseSeries: url.searchParams.get("series"),
      sku: url.searchParams.get("sku"),
      sourceWorksheet: url.searchParams.get("worksheet"),
    }),
    publicationRepository.findActiveRelease(),
    reviewRepository.findCurrentDraftRelease(),
  ]);
  if (!review && requestedReleaseId) {
    throw redirect("/admin/catalog/review");
  }
  const assemblyImpact =
    review?.release.status === "draft"
      ? await createD1CatalogAssemblyImpactRepository(env.DB).recalculate({
          actorId: adminIdentity.id,
          ...auditContext,
          releaseId: review.release.id,
        })
      : null;
  const publicationPreview =
    review?.release.status === "draft"
      ? await publicationRepository.findPublicationPreview(review.release.id)
      : null;
  if (review?.release.status === "draft" && publicationPreview) {
    const differences = publicationPreview;
    const changedSkus = new Set([
      ...differences.products.additions,
      ...differences.products.changes,
      ...differences.products.removals,
      ...differences.prices.additions,
      ...differences.prices.changes,
      ...differences.prices.removals,
      ...differences.images.additions,
      ...differences.images.changes,
      ...differences.images.removals,
    ]);
    const changedRelationshipIds = new Set(
      [
        ...differences.relationships.additions,
        ...differences.relationships.changes,
        ...differences.relationships.removals,
      ].map((key) => key.replace(/^Compatibility\s+/u, "")),
    );
    const changedProducts = review.products.filter((product) =>
      changedSkus.has(product.sku),
    );
    review = {
      ...review,
      compatibilities: review.compatibilities.filter((relationship) =>
        changedRelationshipIds.has(relationship.compatibilityId),
      ),
      products: changedProducts,
      totalCount: changedProducts.length,
    };
  }
  const published = url.searchParams.get("published");
  return {
    activeRelease,
    assemblyRegenerationSummary:
      url.searchParams.get("assemblyUpdated") === "1"
        ? {
            additions: Number(url.searchParams.get("assemblyAdditions")) || 0,
            changes: Number(url.searchParams.get("assemblyChanges")) || 0,
            combinations:
              Number(url.searchParams.get("assemblyCombinations")) || 0,
            removals: Number(url.searchParams.get("assemblyRemovals")) || 0,
            series: Number(url.searchParams.get("assemblySeries")) || 0,
          }
        : null,
    currentDraftRelease,
    publicationSummary:
      published && published === activeRelease?.id
        ? {
            additions: Number(url.searchParams.get("additions")) || 0,
            changes: Number(url.searchParams.get("changes")) || 0,
            deactivations: Number(url.searchParams.get("deactivations")) || 0,
            warnings: Number(url.searchParams.get("warnings")) || 0,
          }
        : null,
    publicationPreview,
    review: review ? { ...review, assemblyImpact } : null,
    updatedCount: Number(url.searchParams.get("updated")) || 0,
  };
}

const impactSourceLabels: Record<
  CatalogAssemblyImpact["sourceChanges"][number]["sourceType"],
  string
> = {
  compatibility: "兼容关系",
  product: "产品",
  shared_derivation_rule: "共享推导规则",
};

function DifferenceGroup({
  differences,
  title,
}: {
  differences: CatalogPublicationPreview["products"];
  title: string;
}) {
  const groups = [
    { items: differences.additions, label: "新增" },
    { items: differences.changes, label: "修改" },
    { items: differences.removals, label: "移除" },
  ];
  return (
    <article>
      <h3>{title}</h3>
      {groups.map((group) => (
        <div key={group.label}>
          <strong>
            {group.label} {group.items.length}
          </strong>
          {group.items.length > 0 ? (
            <ul>
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>无</p>
          )}
        </div>
      ))}
    </article>
  );
}

export function PublicationPreviewPanel({
  preview,
}: {
  preview: CatalogPublicationPreview;
}) {
  return (
    <section
      className="catalog-import-review"
      aria-labelledby="publication-preview-title"
    >
      <div>
        <span className="eyebrow">草稿 → 当前目录</span>
        <h2 id="publication-preview-title">完整发布差异预览</h2>
        <p>
          以下内容按产品、参考价格、主图、兼容关系和衍生总成组合分别显示新增、修改和移除。
        </p>
      </div>
      <div className="release-change-grid">
        <DifferenceGroup differences={preview.products} title="产品" />
        <DifferenceGroup differences={preview.prices} title="参考价格" />
        <DifferenceGroup differences={preview.images} title="产品主图" />
        <DifferenceGroup differences={preview.relationships} title="兼容关系" />
        <DifferenceGroup
          differences={preview.derivedCombinations}
          title="衍生总成组合"
        />
        <article>
          <h3>受影响的胶管系列</h3>
          <strong>{preview.affectedSeries.length} 个系列</strong>
          {preview.affectedSeries.length > 0 ? (
            <ul>
              {preview.affectedSeries.map((series) => (
                <li key={series}>{series}</li>
              ))}
            </ul>
          ) : (
            <p>无</p>
          )}
        </article>
      </div>
    </section>
  );
}

export function AssemblyImpactPanel({
  busy,
  impact,
}: {
  busy: boolean;
  impact: CatalogAssemblyImpact;
}) {
  return (
    <section
      className={`assembly-impact-panel ${impact.stale ? "stale" : "current"}`}
      data-affected-series={impact.affectedSeries.length}
    >
      <div className="assembly-impact-heading">
        <GitBranch size={22} />
        <div>
          <span className="eyebrow">衍生总成数据</span>
          <h2>
            {impact.stale
              ? `${impact.affectedSeries.length} 个受影响的胶管系列需要更新`
              : "总成数据已是最新"}
          </h2>
        </div>
        <span className={`release-status ${impact.stale ? "draft" : "active"}`}>
          {impact.stale ? "待更新" : "最新"}
        </span>
      </div>
      {impact.affectedSeries.length > 0 ? (
        <>
          <p>
            {impact.stale
              ? "系统将在发布前重新生成以下全部系列。"
              : "以下系列已包含在最近一次成功生成中。"}
          </p>
          <div className="assembly-impact-series" aria-label="受影响的胶管系列">
            {impact.affectedSeries.map((series) => (
              <strong key={series}>{series}</strong>
            ))}
          </div>
        </>
      ) : (
        <p>
          未发现影响推导的产品、供应状态或兼容关系变更。仅价格或图片变更不会重新生成组合。
        </p>
      )}
      {impact.sourceChanges.length > 0 ? (
        <details>
          <summary>{impact.sourceChanges.length} 项来源变更</summary>
          <ul>
            {impact.sourceChanges.map((change) => (
              <li key={`${change.sourceType}-${change.key}-${change.kind}`}>
                <strong>{impactSourceLabels[change.sourceType]}</strong>{" "}
                {change.key} · {change.kind}
                {change.affectedSeries.length > 0
                  ? ` · ${change.affectedSeries.join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <small>
        系统计算时间：{impact.calculatedAt}。管理员不能手工缩减此集合。
      </small>
      <Form method="post">
        <input
          name="intent"
          type="hidden"
          value="update_assembly_and_publish"
        />
        <input name="releaseId" type="hidden" value={impact.releaseId} />
        <button className="button button-primary" disabled={busy} type="submit">
          <Check size={17} /> 校验、更新总成并发布
        </button>
      </Form>
    </section>
  );
}

function publicationSuccessUrl(
  releaseId: string,
  summary: CatalogPublicationSummary,
  updatedCount: number,
) {
  const query = new URLSearchParams({
    additions: String(summary.additionCount),
    changes: String(summary.changeCount),
    deactivations: String(summary.deactivationCount),
    published: releaseId,
    updated: String(updatedCount),
    warnings: String(summary.warningCount),
  });
  return `/admin/catalog/review?${query.toString()}`;
}

function SelectorFields({ selector }: { selector: DraftProductSelector }) {
  if (selector.mode === "worksheet") {
    return (
      <input
        name="sourceWorksheet"
        type="hidden"
        value={selector.sourceWorksheet}
      />
    );
  }
  if (selector.mode === "hose_series") {
    return (
      <input name="hoseSeries" type="hidden" value={selector.hoseSeries} />
    );
  }
  return selector.skus.map((sku) => (
    <input key={sku} name="selectedSku" type="hidden" value={sku} />
  ));
}

function ConfirmationPanel({
  cancelTo,
  preview,
}: {
  cancelTo: string;
  preview: DraftAvailabilityChangePreview;
}) {
  return (
    <section
      className="catalog-change-confirmation"
      aria-live="polite"
      data-affected-count={preview.affectedCount}
      data-matched-count={preview.matchedCount}
    >
      <div>
        <ShieldCheck size={22} />
        <div>
          <span className="eyebrow">确认批量修改</span>
          <h2>{availabilityLabels[preview.target]}</h2>
        </div>
      </div>
      <p>
        匹配 {preview.matchedCount} 个产品，其中{" "}
        <strong>{preview.affectedCount}</strong>{" "}
        个将被修改；已经处于目标状态的产品保持不变。本操作只修改待发布目录版本。
      </p>
      <div className="confirmation-actions">
        {preview.affectedCount > 0 ? (
          <Form method="post">
            <input name="intent" type="hidden" value="apply" />
            <input name="releaseId" type="hidden" value={preview.releaseId} />
            <input
              name="selectorMode"
              type="hidden"
              value={preview.selector.mode}
            />
            <input name="target" type="hidden" value={preview.target} />
            <SelectorFields selector={preview.selector} />
            <button className="button button-primary" type="submit">
              <Check size={17} /> 修改 {preview.affectedCount} 个产品
            </button>
          </Form>
        ) : null}
        <Link className="button button-secondary" to={cancelTo}>
          取消
        </Link>
      </div>
    </section>
  );
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST") {
    throw new Response("不允许使用此请求方法", { status: 405 });
  }

  const form = await request.formData();
  const releaseId = textValue(form, "releaseId");
  const intent = textValue(form, "intent");
  const { ipAddress, requestCorrelationId } = requestAuditContext(request);
  const impactRepository = createD1CatalogAssemblyImpactRepository(env.DB);
  const reviewRepository = createD1CatalogDraftReviewRepository(env.DB);
  const regenerationRepository = createD1CatalogAssemblyRegenerationRepository(
    env.DB,
  );
  const publicationRepository = createD1CatalogPublicationRepository(env.DB);

  const publishDraft = async (
    preview: NonNullable<
      Awaited<ReturnType<typeof publicationRepository.findPublicationPreview>>
    >,
    updatedCount: number,
  ) => {
    const result = await publishCatalogRelease(publicationRepository, {
      actorId: adminIdentity.id,
      expectedActiveGeneration: preview.activeGeneration,
      expectedActiveReleaseId: preview.activeRelease?.id ?? null,
      expectedAssemblyState: preview.assemblyState,
      expectedDraftVersion: preview.draftRelease.version,
      generateId: () => `catalog-release-published:${requestCorrelationId}`,
      ipAddress,
      releaseId,
      requestCorrelationId,
    });
    return redirect(
      publicationSuccessUrl(result.releaseId, result.summary, updatedCount),
    );
  };

  const recordWorkflowRejection = async (code: string, message: string) => {
    await publicationRepository.recordRejection({
      actorId: adminIdentity.id,
      auditEventId: `catalog-release-rejected:${requestCorrelationId}:${code}`,
      code,
      ipAddress,
      message,
      occurredAt: new Date().toISOString(),
      releaseId,
      requestCorrelationId,
    });
  };

  if (intent === "preview" || intent === "apply") {
    try {
      const selector = selectorFromForm(form);
      const target = targetFromForm(form);
      if (intent === "preview") {
        return {
          preview: await previewDraftSupplyAvailabilityChange(
            reviewRepository,
            { releaseId, selector, target },
          ),
        };
      }
      const result = await applyDraftSupplyAvailabilityChange(
        reviewRepository,
        {
          actorId: adminIdentity.id,
          releaseId,
          selector,
          target,
        },
      );
      if (!result.applied) {
        return {
          formError: "没有草稿产品需要此项修改。",
          preview: result,
        };
      }
      return redirect(
        `/admin/catalog/review?release=${encodeURIComponent(releaseId)}&updated=${result.affectedCount}`,
      );
    } catch (error) {
      return {
        formError:
          error instanceof Error ? error.message : "目录批量修改失败。",
      };
    }
  }

  try {
    if (intent === "update_assembly_and_publish") {
      const existingPublication =
        await publicationRepository.findPublicationReceipt(
          requestCorrelationId,
        );
      if (existingPublication) {
        if (existingPublication.releaseId === releaseId) {
          return redirect(
            publicationSuccessUrl(
              existingPublication.releaseId,
              existingPublication.summary,
              0,
            ),
          );
        }
        const message = "此请求标识已用于发布另一个目录版本。";
        await recordWorkflowRejection("request_identifier_reused", message);
        return { formError: message };
      }
      await env.DB.prepare(
        `UPDATE catalog_sales_offers AS offer
         SET catalog_publication_status = (
               SELECT product.catalog_publication_status
               FROM catalog_skus product
               WHERE product.import_id = offer.import_id
                 AND product.sku = offer.base_sku
             ),
             rfq_eligibility = (
               SELECT product.rfq_eligibility
               FROM catalog_skus product
               WHERE product.import_id = offer.import_id
                 AND product.sku = offer.base_sku
             ),
             technical_data_status = (
               SELECT product.technical_data_status
               FROM catalog_skus product
               WHERE product.import_id = offer.import_id
                 AND product.sku = offer.base_sku
             )
         WHERE offer.import_id = (
           SELECT source_import_id FROM catalog_releases
           WHERE id = ? AND status = 'draft'
         )
           AND EXISTS (
             SELECT 1 FROM catalog_skus product
             WHERE product.import_id = offer.import_id
               AND product.sku = offer.base_sku
               AND (
                 product.catalog_publication_status <> offer.catalog_publication_status
                 OR product.rfq_eligibility <> offer.rfq_eligibility
                 OR product.technical_data_status <> offer.technical_data_status
               )
           )`,
      )
        .bind(releaseId)
        .run();
      await expandDraftCatalogCompatibilities(env.DB, {
        actorId: adminIdentity.id,
        ipAddress,
        releaseId,
        requestCorrelationId,
      });
      const impact = await impactRepository.recalculate({
        actorId: adminIdentity.id,
        ipAddress,
        releaseId,
        requestCorrelationId,
      });
      if (impact?.stale) {
        await regenerateDerivedAssemblyData(regenerationRepository, {
          actorId: adminIdentity.id,
          ipAddress,
          releaseId,
          requestCorrelationId,
        });
      }
      const preview =
        await publicationRepository.findPublicationPreview(releaseId);
      if (!preview) {
        const message = "未找到待发布的目录草稿。";
        await recordWorkflowRejection("draft_not_found", message);
        return { formError: message };
      }
      if (preview.blockers.length > 0) {
        const message = `发布已停止：请先解决 ${preview.blockers.length} 个校验错误。当前客户目录未发生变化。`;
        await recordWorkflowRejection("publication_blocked", message);
        return {
          formError: message,
          publicationBlockers: preview.blockers,
        };
      }
      return publishDraft(preview, 0);
    }
    return { formError: "未知的目录操作。" };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("catalog publication precondition failed")
    ) {
      await recordWorkflowRejection(
        "stale_publication_state",
        "发布期间目录草稿或当前目录发生了变化。",
      );
      return {
        formError: "发布期间目录草稿或当前目录发生了变化，请重新检查后再发布。",
      };
    }
    if (!(error instanceof CatalogPublicationRejected)) {
      await recordWorkflowRejection(
        error instanceof AssemblyRegenerationRejected
          ? "assembly_regeneration_failed"
          : "publication_workflow_failed",
        error instanceof Error ? error.message : "目录发布流程失败。",
      );
    }
    return {
      formError:
        error instanceof AssemblyRegenerationRejected ||
        error instanceof CatalogPublicationRejected
          ? error.message
          : error instanceof Error
            ? error.message
            : "目录操作失败。",
    };
  }
}

function money(value: number | null, currency = "USD") {
  return value === null ? "未设置" : `${currency} ${value.toFixed(2)}`;
}

function PublicationErrors({
  findings,
}: {
  findings: CatalogPublicationFinding[];
}) {
  if (findings.length === 0) return null;
  return (
    <section className="release-findings blocker" role="alert">
      <div>
        <ShieldCheck size={20} />
        <h2>发布错误</h2>
        <span>{findings.length}</span>
      </div>
      <ul>
        {findings.map((finding, index) => (
          <li key={`${finding.code}-${index}`}>
            <strong>{finding.code}</strong>: {finding.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CatalogReview({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const review = loaderData.review;
  const location = useLocation();
  const navigation = useNavigation();
  const [selectedSkus, setSelectedSkus] = useState<string[]>([]);
  const selected = new Set(selectedSkus);
  const busy = navigation.state === "submitting";
  const publicationBlockers =
    actionData && "publicationBlockers" in actionData
      ? (actionData.publicationBlockers ?? [])
      : [];
  const isDraft = review?.release.status === "draft";

  if (!review) {
    const published = loaderData.publicationSummary;
    return (
      <div className="admin-shell" data-surface="admin">
        <AdminNavigation active="catalog" />
        <main className="catalog-review-page">
          <Link className="button button-secondary" to="/admin">
            <ArrowLeft size={17} /> 返回总览
          </Link>
          <section className="catalog-review-empty">
            <h1>{published ? "目录已发布" : "暂无可用目录"}</h1>
            {published ? (
              <>
                <p>
                  {loaderData.activeRelease?.releaseNumber}{" "}
                  现已成为客户当前目录。
                </p>
                <p>
                  新增 {published.additions} 项，修改 {published.changes}{" "}
                  项，停用 {published.deactivations} 项，警告{" "}
                  {published.warnings} 项。
                </p>
              </>
            ) : (
              <p>请导入并校验已批准的工作簿以创建首个目录。</p>
            )}
            <Link className="button button-primary" to="/admin/catalog/import">
              {published ? "导入另一份工作簿" : "导入工作簿"}
            </Link>
          </section>
        </main>
      </div>
    );
  }

  const allVisibleSelected =
    review.products.length > 0 &&
    review.products.every((product) => selected.has(product.sku));

  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="catalog" />
      <main className="catalog-review-page">
        <div className="diagnostic-toolbar">
          <Link className="button button-secondary" to="/admin">
            <ArrowLeft size={17} /> 返回总览
          </Link>
        </div>

        <header className="catalog-review-header">
          <div>
            <span className="eyebrow">目录操作</span>
            <h1>产品审核与发布</h1>
            <p>
              {review.release.releaseNumber} · {review.totalCount} 个匹配产品
            </p>
          </div>
          <span className={`release-status ${isDraft ? "draft" : "active"}`}>
            {isDraft ? "草稿" : "当前"}
          </span>
        </header>

        <div className="catalog-release-switch" aria-label="目录版本">
          {loaderData.activeRelease ? (
            <Link
              className={`button ${isDraft ? "button-secondary" : "button-primary"}`}
              to="/admin/catalog/review"
            >
              当前 · {loaderData.activeRelease.releaseNumber}
            </Link>
          ) : null}
          {loaderData.currentDraftRelease ? (
            <Link
              className={`button ${isDraft ? "button-primary" : "button-secondary"}`}
              to={`/admin/catalog/review?release=${encodeURIComponent(loaderData.currentDraftRelease.id)}`}
            >
              草稿 · {loaderData.currentDraftRelease.releaseNumber}
            </Link>
          ) : null}
        </div>

        {!isDraft ? (
          <p className="catalog-active-notice">
            这是客户当前可见的目录。请导入新版工作簿以创建可编辑草稿。
          </p>
        ) : null}

        {review.assemblyImpact ? (
          <AssemblyImpactPanel busy={busy} impact={review.assemblyImpact} />
        ) : null}

        {isDraft && loaderData.publicationPreview ? (
          <PublicationPreviewPanel preview={loaderData.publicationPreview} />
        ) : null}

        {loaderData.assemblyRegenerationSummary ? (
          <p className="catalog-update-success" role="status">
            <Check size={17} /> 已更新{" "}
            {loaderData.assemblyRegenerationSummary.series}{" "}
            个系列的衍生总成数据：新增{" "}
            {loaderData.assemblyRegenerationSummary.additions} 项，修改{" "}
            {loaderData.assemblyRegenerationSummary.changes} 项，移除{" "}
            {loaderData.assemblyRegenerationSummary.removals} 项，当前组合{" "}
            {loaderData.assemblyRegenerationSummary.combinations} 项。
          </p>
        ) : null}

        {loaderData.publicationSummary ? (
          <p className="catalog-update-success" role="status">
            <Check size={17} /> 已发布 {review.release.releaseNumber}：新增{" "}
            {loaderData.publicationSummary.additions} 项，修改{" "}
            {loaderData.publicationSummary.changes} 项，停用{" "}
            {loaderData.publicationSummary.deactivations} 项。
          </p>
        ) : null}

        {loaderData.updatedCount > 0 ? (
          <p className="catalog-update-success" role="status">
            <Check size={17} /> 已更新 {loaderData.updatedCount} 个草稿产品。
          </p>
        ) : null}
        {actionData?.formError ? (
          <p className="form-error" role="alert">
            {actionData.formError}
          </p>
        ) : null}
        {actionData && "preview" in actionData && actionData.preview ? (
          <ConfirmationPanel
            cancelTo={`${location.pathname}${location.search}`}
            preview={actionData.preview}
          />
        ) : null}
        <PublicationErrors findings={publicationBlockers} />

        <section className="catalog-review-filters">
          <div>
            <Filter size={20} />
            <div>
              <h2>{isDraft ? "筛选本次变更" : "筛选目录"}</h2>
              <p>
                {isDraft
                  ? "这里只显示当前 Draft 相对 Active 的新增、修改和停用内容。"
                  : "筛选条件只改变审核列表的显示内容。"}
              </p>
            </div>
          </div>
          <Form method="get">
            <input name="release" type="hidden" value={review.release.id} />
            <label>
              <span>工作表类别</span>
              <select
                defaultValue={review.filters.sourceWorksheet ?? ""}
                name="worksheet"
              >
                <option value="">全部工作表</option>
                {review.worksheetOptions.map((worksheet) => (
                  <option key={worksheet} value={worksheet}>
                    {worksheet}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>胶管系列</span>
              <select
                defaultValue={review.filters.hoseSeries ?? ""}
                name="series"
              >
                <option value="">全部系列</option>
                {review.hoseSeriesOptions.map((series) => (
                  <option key={series} value={series}>
                    {series}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>精确 SKU</span>
              <input
                defaultValue={review.filters.sku ?? ""}
                name="sku"
                placeholder="e.g. 601R2_001"
                type="search"
              />
            </label>
            <button className="button button-primary" type="submit">
              <Search size={17} /> 应用筛选
            </button>
            <Link
              className="button button-secondary"
              to={`/admin/catalog/review?release=${encodeURIComponent(review.release.id)}`}
            >
              清除
            </Link>
          </Form>
        </section>

        <Form className="catalog-bulk-form" method="post">
          <input name="intent" type="hidden" value="preview" />
          <input name="releaseId" type="hidden" value={review.release.id} />
          <input
            name="sourceWorksheet"
            type="hidden"
            value={review.filters.sourceWorksheet ?? ""}
          />
          <input
            name="hoseSeries"
            type="hidden"
            value={review.filters.hoseSeries ?? ""}
          />

          {isDraft ? (
            <div className="catalog-bulk-toolbar">
              <label>
                <span>设置供应状态</span>
                <select defaultValue="available_for_quote" name="target">
                  {supplyAvailabilityValues.map((value) => (
                    <option key={value} value={value}>
                      {availabilityLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="catalog-bulk-actions">
                <button
                  className="button button-secondary"
                  disabled={!review.filters.sourceWorksheet || busy}
                  name="selectorMode"
                  type="submit"
                  value="worksheet"
                >
                  预览当前工作表
                </button>
                <button
                  className="button button-secondary"
                  disabled={!review.filters.hoseSeries || busy}
                  name="selectorMode"
                  type="submit"
                  value="hose_series"
                >
                  预览当前胶管系列
                </button>
                <button
                  className="button button-primary"
                  disabled={selectedSkus.length === 0 || busy}
                  name="selectorMode"
                  type="submit"
                  value="selected"
                >
                  预览已选 {selectedSkus.length} 项
                </button>
              </div>
            </div>
          ) : null}

          <div className="catalog-review-table-wrap">
            <table className="catalog-review-table">
              <thead>
                <tr>
                  {isDraft ? (
                    <th className="selection-cell">
                      <input
                        aria-label="选择当前显示的所有产品"
                        checked={allVisibleSelected}
                        onChange={(event) =>
                          setSelectedSkus(
                            event.target.checked
                              ? review.products.map((product) => product.sku)
                              : [],
                          )
                        }
                        type="checkbox"
                      />
                    </th>
                  ) : null}
                  <th>SKU</th>
                  <th>类别</th>
                  <th>系列</th>
                  <th>目录发布状态</th>
                  <th>供应状态</th>
                  <th>参考价格</th>
                  <th>主图</th>
                  <th>成本基础</th>
                  <th>RFQ / 技术资料</th>
                </tr>
              </thead>
              <tbody>
                {review.products.map((product) => (
                  <tr key={product.sku}>
                    {isDraft ? (
                      <td className="selection-cell">
                        <input
                          aria-label={`选择 ${product.sku}`}
                          checked={selected.has(product.sku)}
                          name="selectedSku"
                          onChange={(event) =>
                            setSelectedSkus((current) =>
                              event.target.checked
                                ? [...current, product.sku]
                                : current.filter((sku) => sku !== product.sku),
                            )
                          }
                          type="checkbox"
                          value={product.sku}
                        />
                      </td>
                    ) : null}
                    <td>
                      <strong>{product.sku}</strong>
                      <small>{product.productType}</small>
                    </td>
                    <td>{product.sourceWorksheet}</td>
                    <td>{product.hoseSeries ?? "—"}</td>
                    <td>
                      {product.catalogPublicationStatus === "Published"
                        ? "上线"
                        : product.catalogPublicationStatus === "Archived"
                          ? "停用"
                          : "草稿"}
                    </td>
                    <td>
                      <span
                        className={`availability-badge ${product.supplyAvailability}`}
                      >
                        {availabilityLabels[product.supplyAvailability]}
                      </span>
                    </td>
                    <td>{money(product.referencePriceUsd)}</td>
                    <td>
                      {product.mainImageReference ? (
                        <>
                          版本 {product.mainImageVersion}
                          <small title={product.mainImageReference}>
                            {product.mainImageReference.startsWith(
                              "media-version:",
                            )
                              ? "已上传并标准化"
                              : "已审核的代表图"}
                          </small>
                        </>
                      ) : (
                        <strong>缺失</strong>
                      )}
                    </td>
                    <td>
                      {money(
                        product.factoryUnitPrice,
                        product.costBasisCurrency ?? "USD",
                      )}
                      {product.priceIncoterm ? (
                        <small>{product.priceIncoterm}</small>
                      ) : null}
                    </td>
                    <td>
                      {product.rfqEligibility}
                      <small>{product.technicalDataStatus}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {review.products.length === 0 ? (
              <p className="catalog-review-no-results">
                没有符合筛选条件的产品。
              </p>
            ) : null}
          </div>
        </Form>

        <section className="catalog-import-review">
          <div>
            <span className="eyebrow">工作表 04</span>
            <h2>精确兼容关系</h2>
            <p>
              当前所选{isDraft ? "草稿" : "目录版本"}包含{" "}
              {review.compatibilities.length} 项兼容关系变更。
            </p>
          </div>
          <div className="catalog-review-table-wrap">
            <table className="catalog-review-table">
              <thead>
                <tr>
                  <th>兼容关系 ID</th>
                  <th>胶管 SKU</th>
                  <th>接头 SKU</th>
                  <th>套筒 SKU</th>
                  <th>RFQ / 技术资料</th>
                  <th>资格状态</th>
                  <th>生产批准</th>
                </tr>
              </thead>
              <tbody>
                {review.compatibilities.map((relationship) => (
                  <tr key={relationship.compatibilityId}>
                    <td>
                      <strong>{relationship.compatibilityId}</strong>
                      <small>{relationship.catalogPublicationStatus}</small>
                    </td>
                    <td>{relationship.hoseSku}</td>
                    <td>{relationship.hoseEndSku}</td>
                    <td>{relationship.ferruleSku}</td>
                    <td>
                      {relationship.rfqEligibility}
                      <small>{relationship.technicalDataStatus}</small>
                    </td>
                    <td>{relationship.qualificationStatus}</td>
                    <td>{relationship.productionApprovalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {review.compatibilities.length === 0 ? (
              <p className="catalog-review-no-results">
                此目录版本没有兼容关系变更。
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
