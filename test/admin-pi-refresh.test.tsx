// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import AdminPi from "../app/modules/admin/routes/proforma-invoice";

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
function show(state: "queued" | "failed" | null) {
  return render(
    <RouterProvider
      router={createMemoryRouter([
        {
          path: "/",
          element: (
            <AdminPi
              loaderData={{
                requestId: "request",
                commandId: "command",
                paymentHistory: [],
                readiness: {
                  pdfJobs: state
                    ? [{ commandId: "saved", state, attempts: 0 }]
                    : [],
                  quoteRevision: null,
                  seller: null,
                  payments: [],
                  conditionsConfigured: true,
                  current: null,
                },
              }}
            />
          ),
        },
      ])}
    />,
  );
}
it("pauses generation checks while hidden, resumes when visible and cleans up on exit", async () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const view = show("queued");
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(refresh.revalidate).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  visibility.mockReturnValue("hidden");
  fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(refresh.revalidate).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(refresh.revalidate).toHaveBeenCalledTimes(1);
  fireEvent(document, new Event("visibilitychange"));
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(refresh.revalidate).toHaveBeenCalledTimes(1);
});
it.each(["failed", null] as const)(
  "does not poll when the PDF job is %s",
  async (state) => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    show(state);
    fireEvent(document, new Event("visibilitychange"));
    await act(() => vi.advanceTimersByTimeAsync(30000));
    expect(refresh.revalidate).not.toHaveBeenCalled();
  },
);
