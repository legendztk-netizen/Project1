import {
  Boxes,
  Database,
  FileText,
  FileUp,
  LayoutDashboard,
  Settings,
  Waypoints,
} from "lucide-react";
import { Link } from "react-router";

import { BrandMark } from "../../shared/ui/brand-mark";

export type AdminNavigationKey =
  | "catalog"
  | "configurator"
  | "imports"
  | "overview"
  | "quotes"
  | "releases"
  | "system";

const adminNavigation = [
  { key: "overview", label: "总览", icon: LayoutDashboard, to: "/admin" },
  { key: "quotes", label: "询价审核", icon: FileText, to: "/admin/quotes" },
  {
    key: "catalog",
    label: "产品目录",
    icon: Boxes,
    to: "/admin/catalog/review",
  },
  {
    key: "imports",
    label: "数据导入",
    icon: FileUp,
    to: "/admin/catalog/import",
  },
  {
    key: "releases",
    label: "目录发布",
    icon: Database,
    to: "/admin/catalog/releases",
  },
  {
    key: "configurator",
    label: "配置器数据",
    icon: Waypoints,
    to: "/admin/catalog/reference-data",
  },
  { key: "system", label: "系统", icon: Settings },
] as const;

export function AdminNavigation({ active }: { active: AdminNavigationKey }) {
  return (
    <aside className="admin-sidebar">
      <BrandMark />
      <nav aria-label="管理后台导航">
        {adminNavigation.map(({ key, label, icon: Icon, ...item }) => {
          const activeItem = key === active;
          const content = (
            <>
              <Icon aria-hidden="true" size={18} />
              {label}
            </>
          );
          return "to" in item ? (
            <Link
              aria-current={activeItem ? "page" : undefined}
              className={`admin-nav-item${activeItem ? " active" : ""}`}
              key={key}
              to={item.to}
            >
              {content}
            </Link>
          ) : (
            <span className="admin-nav-item" key={key}>
              {content}
            </span>
          );
        })}
      </nav>
      <Link className="admin-storefront-link" to="/">
        打开客户前台
      </Link>
    </aside>
  );
}
