import { Link } from "react-router";

export function BrandMark() {
  return (
    <Link className="brand-mark" to="/" aria-label="Hydraulic Supply home">
      <span className="brand-symbol" aria-hidden="true">
        HS
      </span>
      <span>
        <strong>Hydraulic Supply</strong>
        <small>Hose &amp; Fittings</small>
      </span>
    </Link>
  );
}
