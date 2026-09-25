import {
  Bell,
  Boxes,
  ClipboardList,
  ChevronDown,
  FileText,
  FileUp,
  LayoutDashboard,
  Settings,
  Waypoints,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";

export type AdminNavigationKey =
  | "catalog"
  | "configurator"
  | "imports"
  | "notifications"
  | "overview"
  | "orders"
  | "quotes"
  | "system";

export type CatalogMaintenanceMode =
  "commercial" | "excel" | "manual" | "items" | "assemblies";

const catalogMaintenanceNavigation = [
  {
    key: "manual",
    label: "管理所有产品",
    to: "/admin/catalog/products",
  },
  {
    key: "commercial",
    label: "销售、包装和价格",
    to: "/admin/catalog/commercial",
  },
  { key: "assemblies", label: "总成管理", to: "/admin/catalog/assemblies" },
] as const;

const adminNavigation = [
  { key: "overview", label: "总览", icon: LayoutDashboard, to: "/admin" },
  {
    key: "notifications",
    label: "通知",
    icon: Bell,
    to: "/admin/notifications",
  },
  { key: "quotes", label: "询价审核", icon: FileText, to: "/admin/quotes" },
  { key: "orders", label: "订单", icon: ClipboardList, to: "/admin/orders" },
  {
    key: "catalog",
    label: "产品审核与发布",
    icon: Boxes,
    to: "/admin/catalog/requests",
  },
  {
    children: catalogMaintenanceNavigation,
    key: "imports",
    label: "产品数据维护",
    icon: FileUp,
  },
  {
    key: "configurator",
    label: "总成参数配置",
    icon: Waypoints,
    to: "/admin/catalog/reference-data",
  },
  {
    key: "system",
    label: "商业设置",
    icon: Settings,
    to: "/admin/settings/commercial",
  },
] as const;

const UNREAD_REFRESH_MS = 30_000;

function useUnreadNotifications(known: number | undefined) {
  const location = useLocation();
  const [unread, setUnread] = useState<number | null>(known ?? null);
  useEffect(() => {
    if (known !== undefined) setUnread(known);
  }, [known]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/admin/notifications/unread-count", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { unread?: unknown };
        if (!cancelled && typeof body.unread === "number")
          setUnread(body.unread);
      } catch {
        // The badge is advisory; the notifications page remains authoritative.
      }
    };
    void refresh();
    const timer = setInterval(refresh, UNREAD_REFRESH_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [location.key]);
  return unread;
}

export function AdminNavigation({
  active,
  maintenanceMode,
  unreadNotifications,
}: {
  active: AdminNavigationKey;
  maintenanceMode?: CatalogMaintenanceMode;
  unreadNotifications?: number;
}) {
  const [openGroup, setOpenGroup] = useState<AdminNavigationKey | null>(
    active === "imports" ? "imports" : null,
  );
  const unread = useUnreadNotifications(unreadNotifications);

  return (
    <aside className="admin-sidebar">
      <BrandMark />
      <nav aria-label="管理后台导航">
        {adminNavigation.map((item) => {
          const activeItem = item.key === active;
          const hasChildren = "children" in item;
          const expanded = hasChildren && openGroup === item.key;
          const Icon = item.icon;
          const content = (
            <>
              <Icon aria-hidden="true" size={18} />
              <span>{item.label}</span>
              {item.key === "notifications" && unread ? (
                <span
                  className="admin-nav-badge"
                  aria-label={`${unread} 条未读`}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </>
          );
          return (
            <div className="admin-nav-group" key={item.key}>
              {hasChildren ? (
                <button
                  aria-controls={`admin-submenu-${item.key}`}
                  aria-expanded={expanded}
                  className={`admin-nav-item admin-nav-toggle${activeItem ? " active" : ""}`}
                  onClick={() =>
                    setOpenGroup((current) =>
                      current === item.key ? null : item.key,
                    )
                  }
                  type="button"
                >
                  {content}
                  <ChevronDown
                    aria-hidden="true"
                    className="admin-nav-chevron"
                    size={16}
                  />
                </button>
              ) : (
                <Link
                  aria-current={activeItem ? "page" : undefined}
                  className={`admin-nav-item${activeItem ? " active" : ""}`}
                  to={item.to}
                >
                  {content}
                </Link>
              )}
              {hasChildren && expanded ? (
                <div
                  aria-label={item.label}
                  className="admin-nav-submenu"
                  id={`admin-submenu-${item.key}`}
                  role="group"
                >
                  {item.children.map((subitem) => {
                    const activeSubitem =
                      activeItem && maintenanceMode === subitem.key;
                    return (
                      <Link
                        aria-current={activeSubitem ? "page" : undefined}
                        className={`admin-nav-subitem${activeSubitem ? " active" : ""}`}
                        key={subitem.key}
                        to={subitem.to}
                      >
                        {subitem.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <Link className="admin-storefront-link" to="/">
        打开客户前台
      </Link>
    </aside>
  );
}
