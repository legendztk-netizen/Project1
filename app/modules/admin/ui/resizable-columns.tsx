import { useEffect, useRef, useState } from "react";

import "./resizable-columns.css";

export interface ResizableColumn {
  id: string;
  label: string;
  /** Default width in CSS pixels. */
  width: number;
  min: number;
}

export const maxColumnWidth = 640;

export function clampColumnWidth(column: ResizableColumn, value: number) {
  return Math.round(Math.min(maxColumnWidth, Math.max(column.min, value)));
}

/**
 * Column widths for an admin table, changed by dragging a header's right edge
 * and remembered in this browser. The last column takes the remaining space.
 */
export function useResizableColumns(
  storageKey: string,
  columns: readonly ResizableColumn[],
) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const latest = useRef(overrides);
  latest.current = overrides;
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) ?? "{}",
      );
      if (saved && typeof saved === "object")
        setOverrides(
          Object.fromEntries(
            Object.entries(saved).filter(
              (entry): entry is [string, number] =>
                typeof entry[1] === "number",
            ),
          ),
        );
    } catch {
      // Storage may be unavailable; default widths still apply.
    }
  }, [storageKey]);
  function save(next: Record<string, number>) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // The widths still apply for this visit.
    }
  }
  function width(column: ResizableColumn) {
    return clampColumnWidth(column, overrides[column.id] ?? column.width);
  }
  function resize(column: ResizableColumn, value: number, persist: boolean) {
    const next = {
      ...latest.current,
      [column.id]: clampColumnWidth(column, value),
    };
    latest.current = next;
    setOverrides(next);
    if (persist) save(next);
  }
  function reset(column: ResizableColumn) {
    const next = { ...latest.current };
    delete next[column.id];
    latest.current = next;
    setOverrides(next);
    save(next);
  }
  return {
    width,
    resize,
    reset,
    tableWidth: columns.reduce((sum, column) => sum + width(column), 0),
  };
}

/** The drag handle on a header cell's right edge; the cell must be positioned. */
export function ColumnResizer({
  column,
  width,
  onResize,
  onReset,
}: {
  column: ResizableColumn;
  width: number;
  onResize: (value: number, persist: boolean) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  // Repeated key presses can arrive before the new width renders.
  const current = useRef(width);
  current.current = width;
  function finish(clientX: number) {
    const start = drag.current;
    if (!start) return;
    drag.current = null;
    document.documentElement.classList.remove("admin-column-resizing");
    onResize(start.width + clientX - start.x, true);
  }
  return (
    <span
      aria-label={`调整「${column.label}」列宽`}
      aria-orientation="vertical"
      aria-valuemax={maxColumnWidth}
      aria-valuemin={column.min}
      aria-valuenow={width}
      className="admin-column-resizer"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
        if (step === undefined) return;
        event.preventDefault();
        current.current = clampColumnWidth(column, current.current + step);
        onResize(current.current, true);
      }}
      onLostPointerCapture={(event) => finish(event.clientX)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width };
        document.documentElement.classList.add("admin-column-resizing");
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) onResize(start.width + event.clientX - start.x, false);
      }}
      onPointerUp={(event) => finish(event.clientX)}
      role="separator"
      tabIndex={0}
      title="拖动调整列宽，双击恢复默认"
    />
  );
}
