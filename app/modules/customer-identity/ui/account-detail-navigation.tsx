import {
  Building2,
  ClipboardList,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MapPin,
  MessagesSquare,
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
    href: "/account/messages",
    icon: MessagesSquare,
    label: "Messages",
    view: "messages",
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
  "quote-list" | "security" | "messages"
>;

export function isAccountDetailView(
  value: string | null,
): value is AccountDetailView {
  return items.some(
    (item) =>
      item.view === value &&
      item.view !== "quote-list" &&
      item.view !== "security" &&
      item.view !== "messages",
  );
}

export function AccountDetailNavigation({
  activeView,
  pendingHref,
  unreadMessages = 0,
}: {
  activeView: AccountNavigationView;
  pendingHref?: string;
  unreadMessages?: number;
}) {
  return (
    <nav className="account-detail-navigation" aria-label="Account details">
      {items.map((item) => {
        const Icon = item.icon;
        const isPending = pendingHref === item.href;
        return (
          <Link
            aria-busy={isPending || undefined}
            aria-current={activeView === item.view ? "page" : undefined}
            className={isPending ? "pending" : undefined}
            key={item.view}
            to={item.href}
          >
            {isPending ? (
              <LoaderCircle
                aria-hidden="true"
                className="account-navigation-spinner"
                size={16}
              />
            ) : (
              <Icon aria-hidden="true" size={16} />
            )}
            {item.label}
            {item.view === "messages" && unreadMessages > 0 && (
              <span
                className="account-nav-badge"
                aria-label={`${unreadMessages} unread`}
              >
                {unreadMessages > 99 ? "99+" : unreadMessages}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
