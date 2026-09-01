import { FileText, KeyRound, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Form, Link, useRouteLoaderData } from "react-router";

import type { RootLoaderData } from "../../../root";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";

interface AccountWorkspaceProps {
  activeSection: "quote-list" | "security";
  children: ReactNode;
}

export function AccountWorkspace({
  activeSection,
  children,
}: AccountWorkspaceProps) {
  const rootData = useRouteLoaderData<RootLoaderData>("root");

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="account-workspace">
        <aside className="account-workspace-sidebar">
          <div>
            <span className="eyebrow">Account &amp; Lists</span>
            <strong>{rootData?.customer?.email}</strong>
          </div>
          <nav aria-label="Account & Lists">
            <Link
              aria-current={activeSection === "quote-list" ? "page" : undefined}
              to="/quote-list"
            >
              <FileText aria-hidden="true" size={18} />
              Quote List
            </Link>
            <Link
              aria-current={activeSection === "security" ? "page" : undefined}
              to="/account/security"
            >
              <KeyRound aria-hidden="true" size={18} />
              Account Security
            </Link>
          </nav>
          <Form action="/sign-out" method="post">
            <button type="submit">
              <LogOut aria-hidden="true" size={17} />
              Sign Out
            </button>
          </Form>
        </aside>
        <section className="account-workspace-detail">{children}</section>
      </main>
    </div>
  );
}
