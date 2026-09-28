import { useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import {
  adminAfterSalesTab,
  adminAfterSalesTabs,
  type AdminAfterSalesTab,
} from "../application/admin-after-sales-navigation";
import "./after-sales.css";

export function AdminAfterSalesTabs({
  counts,
  panels,
}: {
  counts: Record<AdminAfterSalesTab, number>;
  panels: Record<AdminAfterSalesTab, ReactNode>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selected = adminAfterSalesTab(searchParams.get("afterSalesTab"));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  function select(id: AdminAfterSalesTab) {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("tab", "after-sales");
        next.set("afterSalesTab", id);
        return next;
      },
      { preventScrollReset: true },
    );
  }
  return (
    <div className="admin-after-sales-workspace">
      <nav
        className="admin-after-sales-tabs"
        role="tablist"
        aria-label="取消与售后模块"
      >
        {adminAfterSalesTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
            role="tab"
            id={`after-sales-tab-${tab.id}`}
            aria-controls={`after-sales-panel-${tab.id}`}
            aria-selected={selected === tab.id}
            tabIndex={selected === tab.id ? 0 : -1}
            onClick={() => select(tab.id)}
            onKeyDown={(event) => {
              let target: number;
              if (event.key === "ArrowRight")
                target = (index + 1) % adminAfterSalesTabs.length;
              else if (event.key === "ArrowLeft")
                target =
                  (index + adminAfterSalesTabs.length - 1) %
                  adminAfterSalesTabs.length;
              else if (event.key === "Home") target = 0;
              else if (event.key === "End")
                target = adminAfterSalesTabs.length - 1;
              else return;
              event.preventDefault();
              buttons.current[target]?.focus();
              select(adminAfterSalesTabs[target].id);
            }}
          >
            {tab.label}
            <span aria-label={`${counts[tab.id]} 条记录`}>
              {counts[tab.id]}
            </span>
          </button>
        ))}
      </nav>
      <section
        id={`after-sales-panel-${selected}`}
        role="tabpanel"
        aria-labelledby={`after-sales-tab-${selected}`}
        tabIndex={0}
        className="admin-after-sales-panel"
      >
        {panels[selected]}
      </section>
    </div>
  );
}
