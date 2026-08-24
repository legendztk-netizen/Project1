import { CircleHelp } from "lucide-react";
import { Link } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";

export function StorefrontHeader() {
  return (
    <header className="storefront-header">
      <BrandMark />
      <nav aria-label="Customer navigation">
        <Link to="/">Products</Link>
        <span aria-disabled="true">Build a Hose</span>
        <span aria-disabled="true">My Quotes</span>
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
