import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { Form, useNavigation, useRouteLoaderData } from "react-router";

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
  const navigation = useNavigation();

  return (
    <div className="storefront-shell" data-surface="storefront">
      <StorefrontHeader />
      <main className="account-workspace">
        <aside className="account-workspace-sidebar">
          <div>
            <span className="eyebrow">Account &amp; Lists</span>
            <strong>{rootData?.customer?.email}</strong>
          </div>
          <AccountDetailNavigation
            activeView={activeView}
            unreadMessages={rootData?.customer?.unreadMessages ?? 0}
            pendingHref={
              navigation.location
                ? navigation.location.pathname + navigation.location.search
                : undefined
            }
          />
          {/* A document POST: a page left open across a deploy cannot discover
              the sign-out route client-side and would load it with GET. */}
          <Form action="/sign-out" method="post" reloadDocument>
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
