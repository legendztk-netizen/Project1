import { ArrowLeft, CheckCircle2, Database, Plus } from "lucide-react";
import { Form, Link, redirect } from "react-router";

import type { Route } from "./+types/catalog-release-diagnostic";
import { createDiagnosticCatalogRelease } from "../../catalog/domain/catalog-release";
import { createD1CatalogReleaseRepository } from "../../catalog/infrastructure/d1-catalog-release-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";

export function meta() {
  return [{ title: "Catalog Release Diagnostic | Admin Backoffice" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = requireAdminRequestContext(context);
  const repository = createD1CatalogReleaseRepository(env.DB);
  return {
    environment: env.APP_ENV,
    latestRelease: await repository.findLatestDiagnosticDraft(),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  if (env.APP_ENV !== "local") {
    throw new Response(
      "Diagnostic mutation is available only in local development",
      {
        status: 403,
      },
    );
  }
  if (request.method !== "POST")
    throw new Response("Method not allowed", { status: 405 });

  const repository = createD1CatalogReleaseRepository(env.DB);
  const release = await createDiagnosticCatalogRelease(repository, {
    actorId: adminIdentity.id,
  });
  return redirect(`/admin/diagnostics/catalog-release?created=${release.id}`);
}

export default function CatalogReleaseDiagnostic({
  loaderData,
}: Route.ComponentProps) {
  const release = loaderData.latestRelease;

  return (
    <main className="diagnostic-page" data-surface="admin">
      <div className="diagnostic-toolbar">
        <Link className="button button-secondary" to="/admin">
          <ArrowLeft size={17} /> Back to overview
        </Link>
        <span className="environment-badge">
          <Database size={15} /> {loaderData.environment} D1
        </span>
      </div>

      <header>
        <span className="eyebrow">Admin diagnostic</span>
        <h1>Catalog release diagnostic</h1>
        <p>
          Persist and read one non-published draft through the catalog domain
          boundary.
        </p>
      </header>

      <section className="diagnostic-panel" aria-live="polite">
        {release ? (
          <>
            <div className="diagnostic-status">
              <CheckCircle2 size={22} />
              <div>
                <strong>Draft</strong>
                <span>Not published</span>
              </div>
            </div>
            <dl>
              <div>
                <dt>Release number</dt>
                <dd>{release.releaseNumber}</dd>
              </div>
              <div>
                <dt>Release version</dt>
                <dd>Version {release.releaseVersion}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{release.createdAt}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="diagnostic-empty">
            <Database size={25} />
            <strong>No diagnostic release persisted</strong>
          </div>
        )}
      </section>

      <Form method="post">
        <button className="button button-primary" type="submit">
          <Plus size={17} /> Create diagnostic draft
        </button>
      </Form>
    </main>
  );
}
