import { Menu, MessagesSquare, Ruler, UserRound, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";
import type { RootLoaderData } from "../../../root";

export function StorefrontHeader({ floating = false }: { floating?: boolean }) {
  const location = useLocation();
  const rootData = useRouteLoaderData<RootLoaderData>("root");
  const isAuthenticated = Boolean(rootData?.customer);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header
      className={
        floating ? "storefront-header is-floating" : "storefront-header"
      }
    >
      <BrandMark variant="storefront" />
      <nav aria-label="Customer navigation">
        <Link
          className={location.pathname.startsWith("/catalog") ? "active" : ""}
          to="/catalog"
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
          <>
            <Link
              aria-current={
                location.pathname.startsWith("/account/messages")
                  ? "page"
                  : undefined
              }
              className="storefront-account-link"
              to="/account/messages"
            >
              <MessagesSquare aria-hidden="true" size={17} />
              <span>Messages</span>
              {rootData?.customer?.unreadMessages ? (
                <span
                  className="storefront-messages-badge"
                  aria-label={`${rootData.customer.unreadMessages} unread`}
                >
                  {rootData.customer.unreadMessages > 99
                    ? "99+"
                    : rootData.customer.unreadMessages}
                </span>
              ) : null}
            </Link>
            <Link
              aria-current={
                location.pathname === "/quote-list" ||
                (location.pathname.startsWith("/account") &&
                  !location.pathname.startsWith("/account/messages"))
                  ? "page"
                  : undefined
              }
              className="storefront-account-link"
              to="/account"
            >
              <UserRound aria-hidden="true" size={17} />
              <span>Account &amp; Lists</span>
            </Link>
          </>
        ) : (
          <>
            <Link className="storefront-register-link" to="/register">
              Register
            </Link>
            <Link className="storefront-account-link" to="/sign-in">
              <UserRound aria-hidden="true" size={17} />
              <span>Sign In</span>
            </Link>
          </>
        )}
        <Link
          className="button button-secondary"
          to="/assembly-measurement-guide"
        >
          <Ruler size={17} />
          <span>Measurement Guide</span>
        </Link>
      </div>

      <button
        aria-expanded={mobileMenuOpen}
        aria-label={
          mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
        }
        className="storefront-mobile-toggle"
        onClick={() => setMobileMenuOpen((prev) => !prev)}
        type="button"
      >
        {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

      {mobileMenuOpen ? (
        <div className="storefront-mobile-drawer">
          <div className="storefront-mobile-drawer-section">
            <Link
              className={
                location.pathname.startsWith("/catalog")
                  ? "is-active"
                  : undefined
              }
              onClick={() => setMobileMenuOpen(false)}
              to="/catalog"
            >
              Products
            </Link>
            <Link
              className={
                location.pathname === "/build-a-hose" ? "is-active" : undefined
              }
              onClick={() => setMobileMenuOpen(false)}
              to="/build-a-hose"
            >
              Build a Hose
            </Link>
            {!isAuthenticated ? (
              <Link
                className={
                  location.pathname === "/quote-list" ? "is-active" : undefined
                }
                onClick={() => setMobileMenuOpen(false)}
                to="/quote-list"
              >
                Quote List
              </Link>
            ) : null}
          </div>
          <div className="storefront-mobile-drawer-section">
            {isAuthenticated ? (
              <>
                <Link
                  onClick={() => setMobileMenuOpen(false)}
                  to="/account/messages"
                >
                  <span>Messages</span>
                  {rootData?.customer?.unreadMessages ? (
                    <span className="storefront-messages-badge">
                      {rootData.customer.unreadMessages > 99
                        ? "99+"
                        : rootData.customer.unreadMessages}
                    </span>
                  ) : null}
                </Link>
                <Link onClick={() => setMobileMenuOpen(false)} to="/account">
                  Account &amp; Lists
                </Link>
              </>
            ) : (
              <>
                <Link onClick={() => setMobileMenuOpen(false)} to="/sign-in">
                  Sign In
                </Link>
                <Link onClick={() => setMobileMenuOpen(false)} to="/register">
                  Register
                </Link>
              </>
            )}
            <Link
              onClick={() => setMobileMenuOpen(false)}
              to="/assembly-measurement-guide"
            >
              Measurement Guide
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
