// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import QuoteReviews from "../app/modules/admin/routes/quote-reviews";

const refresh = vi.hoisted(() => ({
  state: "idle",
  revalidate: vi.fn(async () => {}),
}));
vi.mock("react-router", async (original) => ({
  ...(await original<typeof import("react-router")>()),
  useRevalidator: () => refresh,
}));
vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => null,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  refresh.revalidate.mockReset();
});
function show(page = 1, hasNext = true) {
  return render(
    <MemoryRouter initialEntries={["/admin/quotes"]}>
      <QuoteReviews
        {...({
          loaderData: {
            adminIdentity: { accountType: "admin" },
            environment: "local",
            filters: {
              reviewState: "awaiting_review",
              technicalReview: "all",
              sort: "newest",
            },
            reviews: [],
            page,
            hasNext,
          },
        } as unknown as Parameters<typeof QuoteReviews>[0])}
      />
    </MemoryRouter>,
  );
}
it("preserves filters in both pagination links and identifies page-local metrics", () => {
  show(2);
  for (const [name, page] of [
    ["上一页", 1],
    ["下一页", 3],
  ] as const) {
    expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(
      `/admin/quotes?review=awaiting_review&technical=all&sort=newest&page=${page}`,
    );
  }
  expect(screen.getByRole("region", { name: "本页筛选结果" })).toBeTruthy();
});
it("pauses hidden polling and coalesces manual, focus and visibility refreshes", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible");
  let finish!: () => void;
  refresh.revalidate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = show();
  expect(screen.queryByRole("link", { name: "上一页" })).toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(29999));
  expect(refresh.revalidate).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(refresh.revalidate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "立即刷新" }));
  fireEvent.focus(window);
  fireEvent(document, new Event("visibilitychange"));
  expect(refresh.revalidate).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  visibility.mockReturnValue("hidden");
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(refresh.revalidate).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("visible");
  fireEvent.click(screen.getByRole("button", { name: "立即刷新" }));
  expect(refresh.revalidate).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(30000));
  fireEvent.focus(window);
  expect(refresh.revalidate).toHaveBeenCalledTimes(2);
});
