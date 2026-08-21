import {
  Activity,
  Boxes,
  Database,
  FileUp,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import { Link } from "react-router";

import type { Route } from "./+types/admin-home";
import { BrandMark } from "../../shared/ui/brand-mark";
import { cloudflareContext } from "#workers/context";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Admin Backoffice | Hydraulic Supply" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = context.get(cloudflareContext);
  return { environment: env.APP_ENV };
}

const adminNavigation = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Catalog", icon: Boxes },
  { label: "Imports", icon: FileUp },
  { label: "Releases", icon: Database },
  { label: "System", icon: Settings },
];

export default function AdminHome({ loaderData }: Route.ComponentProps) {
  return (
    <div className="admin-shell" data-surface="admin">
      <aside className="admin-sidebar">
        <BrandMark />
        <nav aria-label="Admin navigation">
          {adminNavigation.map(({ label, icon: Icon }) => (
            <span
              aria-current={label === "Overview" ? "page" : undefined}
              className={`admin-nav-item${label === "Overview" ? " active" : ""}`}
              key={label}
            >
              <Icon size={18} />
              {label}
            </span>
          ))}
        </nav>
        <Link className="admin-storefront-link" to="/">
          Open storefront
        </Link>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="eyebrow">Admin Backoffice</span>
            <h1>Overview</h1>
          </div>
          <span className="environment-badge">
            <Activity size={15} /> {loaderData.environment}
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
            <strong>Not published</strong>
            <small>Import workflow pending</small>
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
        </section>
      </main>
    </div>
  );
}
