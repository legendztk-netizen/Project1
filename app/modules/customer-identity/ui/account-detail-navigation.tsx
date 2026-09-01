import {
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  MapPin,
  Save,
} from "lucide-react";
import { Link } from "react-router";

const items = [
  { href: "/account", icon: Gauge, label: "Overview", view: "overview" },
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
    href: "/account?view=profile",
    icon: Building2,
    label: "Profile / Company",
    view: "profile",
  },
] as const;

export type AccountDetailView = (typeof items)[number]["view"];

export function isAccountDetailView(
  value: string | null,
): value is AccountDetailView {
  return items.some((item) => item.view === value);
}

export function AccountDetailNavigation({
  activeView,
}: {
  activeView: AccountDetailView;
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
