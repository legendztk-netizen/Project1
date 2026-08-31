import { Ruler, UserRound } from "lucide-react";
import { Link, useLocation } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";

export function StorefrontHeader() {
  const location = useLocation();
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
        <Link
          className={location.pathname === "/quote-list" ? "active" : ""}
          to="/quote-list"
        >
          Quote List
        </Link>
      </nav>
      <div className="storefront-header-actions">
        <Link className="storefront-register-link" to="/register">
          Register
        </Link>
        <Link className="storefront-account-link" to="/sign-in">
          <UserRound size={18} />
          <span>Sign In</span>
        </Link>
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
