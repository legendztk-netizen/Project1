import { CircleHelp } from "lucide-react";
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
        <span aria-disabled="true">Build a Hose</span>
        <Link
          className={location.pathname === "/quote-list" ? "active" : ""}
          to="/quote-list"
        >
          Quote List
        </Link>
      </nav>
      <span
        className="button button-secondary is-disabled"
        aria-disabled="true"
      >
        <CircleHelp size={18} />
        Help
      </span>
    </header>
  );
}
