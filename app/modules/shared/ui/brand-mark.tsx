import { Link } from "react-router";

export function BrandMark({
  variant = "admin",
}: {
  variant?: "admin" | "storefront";
}) {
  if (variant === "storefront") {
    return (
      <Link
        className="brand-mark brand-mark-storefront"
        to="/"
        aria-label="customhoseco home"
      >
        <img
          alt=""
          aria-hidden="true"
          className="brand-mark-icon"
          height={32}
          src="/images/brand/customhoseco-mark.svg"
          width={32}
        />
        <span className="brand-wordmark">
          <span>custom</span>
          <span className="brand-wordmark-accent">hose</span>
          <span>co</span>
        </span>
      </Link>
    );
  }

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
