import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Form, useRouteLoaderData } from "react-router";

import type { RootLoaderData } from "../../../root";
import { StorefrontHeader } from "../../storefront/ui/storefront-header";
import {
  AccountDetailNavigation,
  type AccountNavigationView,
} from "./account-detail-navigation";

interface AccountWorkspaceProps {
  activeView: AccountNavigationView;
  children: ReactNode;
}

export function AccountWorkspace({
  activeView,
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
          <AccountDetailNavigation activeView={activeView} />
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
