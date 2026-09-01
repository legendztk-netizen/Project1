import {
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  MapPin,
  Save,
} from "lucide-react";
import { Link } from "react-router";

const items = [
  { href: "/account", icon: Gauge, label: "Overview", view: "overview" },
  {
    href: "/quote-list",
    icon: ListChecks,
    label: "Quote List",
    view: "quote-list",
  },
  {
    href: "/account?view=saved-configurations",
    icon: Save,
    label: "Saved Configurations",
    view: "saved-configurations",
  },
  {
    href: "/account?view=my-quotes",
    icon: FileText,
    label: "My Quotes",
    view: "my-quotes",
  },
  {
    href: "/account?view=orders",
    icon: ClipboardList,
    label: "Orders",
    view: "orders",
  },
  {
    href: "/account?view=addresses",
    icon: MapPin,
    label: "Addresses",
    view: "addresses",
  },
  {
    href: "/account/security",
    icon: KeyRound,
    label: "Account Security",
    view: "security",
  },
  {
    href: "/account?view=profile",
    icon: Building2,
    label: "Profile / Company",
    view: "profile",
  },
] as const;

export type AccountNavigationView = (typeof items)[number]["view"];
export type AccountDetailView = Exclude<
  AccountNavigationView,
  "quote-list" | "security"
>;

export function isAccountDetailView(
  value: string | null,
): value is AccountDetailView {
  return items.some(
    (item) =>
      item.view === value &&
      item.view !== "quote-list" &&
      item.view !== "security",
  );
}

export function AccountDetailNavigation({
  activeView,
}: {
  activeView: AccountNavigationView;
}) {
  return (
    <nav className="account-detail-navigation" aria-label="Account details">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            aria-current={activeView === item.view ? "page" : undefined}
            key={item.view}
            to={item.href}
          >
            <Icon aria-hidden="true" size={16} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
