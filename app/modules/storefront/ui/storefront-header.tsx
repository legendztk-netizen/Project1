import { Ruler } from "lucide-react";
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
      <Link
        className="button button-secondary"
        to="/assembly-measurement-guide"
      >
        <Ruler size={18} />
        <span>Measurement Guide</span>
      </Link>
    </header>
  );
}
