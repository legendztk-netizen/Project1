import { Link } from "react-router";

export function BrandMark({
  variant = "admin",
}: {
  variant?: "admin" | "storefront-header" | "storefront-footer";
}) {
  if (variant === "storefront-header") {
    return (
      <Link
        className="brand-mark brand-mark-header"
        to="/"
        aria-label="Hydraulic Supply home"
      >
        <img
          alt=""
          aria-hidden="true"
          className="brand-mark-icon"
          height={36}
          src="/images/brand/customhoseco-mark.svg"
          width={36}
        />
        <span>
          <strong>Hydraulic Supply</strong>
          <small>Hose &amp; Fittings</small>
        </span>
      </Link>
    );
  }

  if (variant === "storefront-footer") {
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
          height={44}
          src="/images/brand/customhoseco-mark.svg"
          width={44}
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
