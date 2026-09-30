import { Link } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";
import "../styles/storefront-footer.css";

const footerColumns = [
  {
    heading: "Products",
    links: [
      { label: "Hydraulic Hose", to: "/catalog/hydraulic-hose" },
      { label: "Hose Ends", to: "/catalog/hose-ends" },
      { label: "Ferrules", to: "/catalog/ferrules" },
      { label: "Adapters", to: "/catalog/adapters" },
      { label: "Quick Couplers", to: "/catalog/quick-couplers" },
    ],
  },
  {
    heading: "Build & Quote",
    links: [
      { label: "Build a Hose", to: "/build-a-hose" },
      { label: "Measurement Guide", to: "/assembly-measurement-guide" },
      { label: "Quote List", to: "/quote-list" },
    ],
  },
  {
    heading: "Account",
    links: [
      { label: "Sign In", to: "/sign-in" },
      { label: "Register", to: "/register" },
      { label: "My Account", to: "/account" },
      { label: "Returns Policy", to: "/policies/returns" },
    ],
  },
];

export function StorefrontFooter({ appName }: { appName: string }) {
  return (
    <footer className="storefront-footer">
      <div className="storefront-footer-inner">
        <div className="storefront-footer-brand">
          <BrandMark />
          <p>
            Made-to-order hydraulic hose assemblies, hose ends and fittings for
            North American repair shops, OEMs and distributors. Configure your
            assembly online, receive a Proforma Invoice, and we build it to your
            length.
          </p>
        </div>
        <nav className="storefront-footer-nav" aria-label="Footer">
          {footerColumns.map((column) => (
            <div key={column.heading}>
              <h2>{column.heading}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.to}>
                    <Link to={link.to}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="storefront-footer-legal">
        <span>
          © {new Date().getUTCFullYear()} {appName}
        </span>
        <span>customhoseco.com</span>
      </div>
    </footer>
  );
}
