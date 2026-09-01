import { Ruler, UserRound } from "lucide-react";
import { Link, useLocation, useRouteLoaderData } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";
import type { RootLoaderData } from "../../../root";

export function StorefrontHeader() {
  const location = useLocation();
  const rootData = useRouteLoaderData<RootLoaderData>("root");
  const isAuthenticated = Boolean(rootData?.customer);
  return (
    <header className="storefront-header">
      <BrandMark />
      <nav aria-label="Customer navigation">
        <Link
          className={
            location.pathname === "/" ||
            location.pathname.startsWith("/catalog")
              ? "active"
              : ""
          }
          to="/"
        >
          Products
        </Link>
        <Link
          className={location.pathname === "/build-a-hose" ? "active" : ""}
          to="/build-a-hose"
        >
          Build a Hose
        </Link>
        {!isAuthenticated ? (
          <Link
            className={location.pathname === "/quote-list" ? "active" : ""}
            to="/quote-list"
          >
            Quote List
          </Link>
        ) : null}
      </nav>
      <div className="storefront-header-actions">
        {isAuthenticated ? (
          <Link
            aria-current={
              location.pathname === "/quote-list" ||
              location.pathname.startsWith("/account")
                ? "page"
                : undefined
            }
            className="storefront-account-link"
            to="/quote-list"
          >
            <UserRound aria-hidden="true" size={18} />
            <span>Account &amp; Lists</span>
          </Link>
        ) : (
          <>
            <Link className="storefront-register-link" to="/register">
              Register
            </Link>
            <Link className="storefront-account-link" to="/sign-in">
              <UserRound aria-hidden="true" size={18} />
              <span>Sign In</span>
            </Link>
          </>
        )}
        <Link
          className="button button-secondary"
          to="/assembly-measurement-guide"
        >
          <Ruler size={18} />
          <span>Measurement Guide</span>
        </Link>
      </div>
    </header>
  );
}
