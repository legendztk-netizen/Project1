import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleOff,
  GitCompareArrows,
  Plus,
  Rocket,
  ShieldAlert,
} from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/catalog-releases";
import {
  CatalogPublicationRejected,
  publishCatalogRelease,
  type CatalogPublicationPreview,
} from "../../catalog/domain/catalog-publication";
import { createD1CatalogPublicationRepository } from "../../catalog/infrastructure/d1-catalog-publication-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export function meta() {
  return [{ title: "Catalog Releases | Admin Backoffice" }];
}

function textValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function integerValue(form: FormData, key: string) {
  const value = Number(textValue(form, key));
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const repository = createD1CatalogPublicationRepository(env.DB);
  const url = new URL(request.url);
  const activeRelease = await repository.findActiveRelease();
  return {
    activeRelease,
    preview: await repository.findPublicationPreview(
      url.searchParams.get("release"),
    ),
    published:
      url.searchParams.get("published") === activeRelease?.id
        ? activeRelease
        : null,
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (request.method !== "POST") {
    throw new Response("Method not allowed", { status: 405 });
  }
  const form = await request.formData();
  const releaseId = textValue(form, "releaseId");
  const intent = textValue(form, "intent");
  const repository = createD1CatalogPublicationRepository(env.DB);

  try {
    if (intent === "confirm") {
      const preview = await repository.findPublicationPreview(releaseId);
      if (!preview)
        return { formError: "Draft Catalog Release was not found." };
      if (preview.blockers.length > 0) {
        return {
          formError: `Resolve ${preview.blockers.length} publication blocker${preview.blockers.length === 1 ? "" : "s"} before continuing.`,
        };
      }
      return { confirmation: preview };
    }
    if (intent === "publish") {
      const requestCorrelationId =
        request.headers.get("cf-ray") ??
        request.headers.get("x-request-id") ??
        `local-${crypto.randomUUID()}`;
      await publishCatalogRelease(repository, {
        actorId: adminIdentity.id,
        expectedActiveGeneration: integerValue(
          form,
          "expectedActiveGeneration",
        ),
        expectedActiveReleaseId:
          textValue(form, "expectedActiveReleaseId") || null,
        expectedDraftVersion: integerValue(form, "expectedDraftVersion"),
        generateId: () => `catalog-release-published:${requestCorrelationId}`,
        releaseId,
        requestCorrelationId,
      });
      return redirect(
        `/admin/catalog/releases?published=${encodeURIComponent(releaseId)}`,
      );
    }
    return { formError: "Unknown Catalog Release command." };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("catalog publication precondition failed")
    ) {
      return {
        formError:
          "The active release or draft changed. Review the publication again.",
      };
    }
    return {
      formError:
        error instanceof CatalogPublicationRejected
          ? error.message
          : "Catalog Release publication failed.",
    };
  }
}

function ChangeList({
  emptyLabel,
  items,
}: {
  emptyLabel: string;
  items: string[];
}) {
  if (items.length === 0) return <p>{emptyLabel}</p>;
  const visible = items.slice(0, 12);
  return (
    <>
      <p>{visible.join(", ")}</p>
      {items.length > visible.length ? (
        <details className="release-change-details">
          <summary>View all {items.length}</summary>
          <ul>
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

function PublicationSummary({
  preview,
}: {
  preview: CatalogPublicationPreview;
}) {
  const summaries = [
    {
      className: "addition",
      empty: "No newly visible products.",
      icon: Plus,
      items: preview.additions,
      label: "Additions",
    },
    {
      className: "change",
      empty: "No customer-facing product changes.",
      icon: GitCompareArrows,
      items: preview.changes,
      label: "Changes",
    },
    {
      className: "deactivation",
      empty: "No products removed from the customer release.",
      icon: CircleOff,
      items: preview.deactivations,
      label: "Deactivations",
    },
  ];
  return (
    <div className="release-change-grid">
      {summaries.map(({ className, empty, icon: Icon, items, label }) => (
        <article className={className} key={label}>
          <div>
            <Icon size={19} />
            <span>{label}</span>
            <strong>{items.length}</strong>
          </div>
          <ChangeList emptyLabel={empty} items={items} />
        </article>
      ))}
    </div>
  );
}

function FindingList({
  findings,
  kind,
}: {
  findings: CatalogPublicationPreview["blockers"];
  kind: "blocker" | "warning";
}) {
  if (findings.length === 0) return null;
  const Icon = kind === "blocker" ? ShieldAlert : AlertTriangle;
  return (
    <section className={`release-findings ${kind}`}>
      <div>
        <Icon size={21} />
        <h2>
          {findings.length} {kind}
          {findings.length === 1 ? "" : "s"}
        </h2>
      </div>
      <ul>
        {findings.map((finding, index) => (
          <li key={`${finding.code}-${index}`}>
            <strong>{finding.code}</strong> {finding.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Confirmation({ preview }: { preview: CatalogPublicationPreview }) {
  return (
    <section className="release-publication-confirmation" aria-live="polite">
      <div>
        <Rocket size={22} />
        <div>
          <span className="eyebrow">Final confirmation</span>
          <h2>Publish {preview.draftRelease.releaseNumber}?</h2>
        </div>
      </div>
      <p>
        This atomically replaces the active customer Catalog Release. The prior
        release remains immutable and resolvable in history.
      </p>
      <div className="confirmation-actions">
        <Form method="post">
          <input name="intent" type="hidden" value="publish" />
          <input
            name="releaseId"
            type="hidden"
            value={preview.draftRelease.id}
          />
          <input
            name="expectedDraftVersion"
            type="hidden"
            value={preview.draftRelease.version}
          />
          <input
            name="expectedActiveGeneration"
            type="hidden"
            value={preview.activeGeneration}
          />
          <input
            name="expectedActiveReleaseId"
            type="hidden"
            value={preview.activeRelease?.id ?? ""}
          />
          <button className="button button-primary" type="submit">
            <Rocket size={17} /> Publish Catalog Release
          </button>
        </Form>
        <Link
          className="button button-secondary"
          to={`/admin/catalog/releases?release=${encodeURIComponent(preview.draftRelease.id)}`}
        >
          Cancel
        </Link>
      </div>
    </section>
  );
}

export default function CatalogReleases({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const preview = loaderData.preview;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";

  return (
    <main className="catalog-release-page" data-surface="admin">
      <div className="diagnostic-toolbar">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
      </div>

      <header className="catalog-release-header">
        <div>
          <span className="eyebrow">Catalog operations</span>
          <h1>Catalog Releases</h1>
          <p>Revalidate and publish one complete customer catalogue.</p>
        </div>
        <div className="active-release-summary">
          <span>Active release</span>
          <strong>
            {loaderData.activeRelease?.releaseNumber ?? "Not published"}
          </strong>
        </div>
      </header>

      {loaderData.published ? (
        <p className="catalog-update-success" role="status">
          <Check size={17} /> Published {loaderData.published.releaseNumber}.
        </p>
      ) : null}
      {actionData?.formError ? (
        <p className="form-error" role="alert">
          {actionData.formError}
        </p>
      ) : null}
      {actionData?.confirmation ? (
        <Confirmation preview={actionData.confirmation} />
      ) : null}

      {preview ? (
        <>
          <section className="release-candidate">
            <div>
              <span className="eyebrow">Draft candidate</span>
              <h2>{preview.draftRelease.releaseNumber}</h2>
            </div>
            <dl>
              <div>
                <dt>Draft version</dt>
                <dd>{preview.draftRelease.version}</dd>
              </div>
              <div>
                <dt>Prior active</dt>
                <dd>
                  {preview.activeRelease?.releaseNumber ?? "First release"}
                </dd>
              </div>
              <div>
                <dt>Warnings</dt>
                <dd>{preview.warnings.length}</dd>
              </div>
              <div>
                <dt>Blockers</dt>
                <dd>{preview.blockers.length}</dd>
              </div>
            </dl>
          </section>

          <PublicationSummary preview={preview} />
          <FindingList findings={preview.warnings} kind="warning" />
          <FindingList findings={preview.blockers} kind="blocker" />

          <Form className="release-review-action" method="post">
            <input name="intent" type="hidden" value="confirm" />
            <input
              name="releaseId"
              type="hidden"
              value={preview.draftRelease.id}
            />
            <button
              className="button button-primary"
              disabled={busy || preview.blockers.length > 0}
              type="submit"
            >
              <Rocket size={17} />
              {preview.blockers.length > 0
                ? "Resolve blockers before publishing"
                : "Review publication"}
            </button>
          </Form>
        </>
      ) : (
        <section className="catalog-review-empty">
          <h2>No publishable draft available</h2>
          <p>Import a new workbook to create the next Catalog Release.</p>
          <Link className="button button-primary" to="/admin/catalog/import">
            Import workbook
          </Link>
        </section>
      )}
    </main>
  );
}
