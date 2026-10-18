// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import {
  ColumnResizer,
  maxColumnWidth,
  useResizableColumns,
  type ResizableColumn,
} from "../app/modules/admin/ui/resizable-columns";

const storageKey = "test-columns";
const columns: ResizableColumn[] = [
  { id: "email", label: "邮箱", width: 200, min: 120 },
  { id: "amount", label: "金额", width: 100, min: 80 },
];

function Table() {
  const widths = useResizableColumns(storageKey, columns);
  return (
    <table data-width={widths.tableWidth}>
      <colgroup>
        <col
          data-testid="email-col"
          style={{ width: widths.width(columns[0]) }}
        />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th>
            邮箱
            <ColumnResizer
              column={columns[0]}
              onReset={() => widths.reset(columns[0])}
              onResize={(value, persist) =>
                widths.resize(columns[0], value, persist)
              }
              width={widths.width(columns[0])}
            />
          </th>
          <th>金额</th>
        </tr>
      </thead>
    </table>
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("drags a column wider, keeps it within bounds and remembers it", () => {
  render(<Table />);
  const handle = screen.getByRole("separator", { name: "调整「邮箱」列宽" });
  fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 360, pointerId: 1 });
  // Dragging previews without saving until the pointer is released.
  expect(handle.getAttribute("aria-valuenow")).toBe("260");
  expect(localStorage.getItem(storageKey)).toBeNull();
  fireEvent.pointerUp(handle, { clientX: 360, pointerId: 1 });
  expect(screen.getByTestId("email-col").style.width).toBe("260px");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
    email: 260,
  });
  expect(document.querySelector("table")?.dataset.width).toBe("360");

  fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 2000, pointerId: 1 });
  expect(handle.getAttribute("aria-valuenow")).toBe(String(maxColumnWidth));
});

it("steps with the arrow keys down to the minimum and resets on double-click", () => {
  localStorage.setItem(storageKey, JSON.stringify({ email: 150 }));
  render(<Table />);
  const handle = screen.getByRole("separator", { name: "调整「邮箱」列宽" });
  expect(handle.getAttribute("aria-valuenow")).toBe("150");
  for (let press = 0; press < 5; press += 1)
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle.getAttribute("aria-valuenow")).toBe("120");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle.getAttribute("aria-valuenow")).toBe("136");
  fireEvent.doubleClick(handle);
  expect(handle.getAttribute("aria-valuenow")).toBe("200");
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({});
});
