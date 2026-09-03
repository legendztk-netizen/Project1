import {
  Activity,
  Boxes,
  Database,
  FileUp,
  Rocket,
  Waypoints,
} from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/admin-home";
import { createD1CatalogPublicationRepository } from "../../catalog/infrastructure/d1-catalog-publication-repository";
import { requireAdminRequestContext } from "../infrastructure/admin-request-context";
import { AdminNavigation } from "../ui/admin-navigation";

export function meta() {
  return [{ title: "Admin Backoffice | Hydraulic Supply" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const { adminIdentity, env } = requireAdminRequestContext(context);
  const activeRelease = await createD1CatalogPublicationRepository(
    env.DB,
  ).findActiveRelease();
  return { activeRelease, adminIdentity, environment: env.APP_ENV };
}

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  return (
    <div className="admin-shell" data-surface="admin">
      <AdminNavigation active="overview" />

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">Admin Backoffice</span>
            <h1>Overview</h1>
          </div>
          <span className="environment-badge">
            <Activity size={15} /> {loaderData.adminIdentity.accountType} ·{" "}
            {loaderData.environment}
          </span>
        </header>

        <section className="admin-metrics" aria-label="Platform status">
          <article>
            <span>Application</span>
            <strong>Running</strong>
            <small>Cloudflare Worker</small>
          </article>
          <article>
            <span>Catalog release</span>
            <strong>
              {loaderData.activeRelease?.releaseNumber ?? "Not published"}
            </strong>
            <small>
              {loaderData.activeRelease
                ? "Active customer release"
                : "Import workflow pending"}
            </small>
          </article>
          <article>
            <span>Environment</span>
            <strong>{loaderData.environment}</strong>
            <small>Runtime binding</small>
          </article>
        </section>

        <section className="admin-panel">
          <div>
            <span className="eyebrow">System boundary</span>
            <h2>Catalog operations</h2>
          </div>
          <div className="empty-state">
            <Database size={24} />
            <div>
              <strong>No catalog release yet</strong>
              <p>The import and release workflow will appear here.</p>
            </div>
          </div>
          <Link className="button button-primary" to="/admin/catalog/import">
            <FileUp size={17} /> Import product workbook
          </Link>
          <Link className="button button-secondary" to="/admin/catalog/review">
            <Boxes size={17} /> Review draft products
          </Link>
          <Link
            className="button button-secondary"
            to="/admin/catalog/releases"
          >
            <Rocket size={17} /> Publish Catalog Release
          </Link>
          <Link
            className="button button-secondary"
            to="/admin/catalog/reference-data"
          >
            <Waypoints size={17} /> Configurator Reference Data
          </Link>
          <Link
            className="button button-secondary"
            to="/admin/diagnostics/catalog-release"
          >
            <Database size={17} /> Open D1 diagnostic
          </Link>
        </section>
      </main>
    </div>
  );
}
