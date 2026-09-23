// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import QuoteReviewDetail from "../app/modules/admin/routes/quote-review-detail";

vi.mock("../app/modules/admin/ui/admin-navigation", () => ({
  AdminNavigation: () => null,
}));

afterEach(cleanup);

function showActions(hasDraft: boolean, hasCurrentPi: boolean) {
  const loaderData = {
    hasDraft,
    hasCurrentPi,
    review: {
      id: "request-1",
      referenceNumber: "QR-TEST-1",
      submittedAt: "2026-09-21T00:00:00.000Z",
      snapshot: {},
      technicalReview: { state: "not_flagged", reasons: [] },
    },
    technical: {
      basis: "request-1",
      fingerprint: "fingerprint",
      snapshot: {},
      completion: null,
    },
  } as unknown as Parameters<typeof QuoteReviewDetail>[0]["loaderData"];
  const router = createMemoryRouter(
    [
      {
        path: "/admin/quotes/:requestId",
        element: (
          <QuoteReviewDetail
            {...({ loaderData } as Parameters<typeof QuoteReviewDetail>[0])}
          />
        ),
      },
    ],
    { initialEntries: ["/admin/quotes/request-1"] },
  );
  render(<RouterProvider router={router} />);
}

it("shows unavailable workflow entries with their prerequisites", () => {
  showActions(false, false);
  expect(
    screen.getByRole("button", { name: "商业与交付条款：请先开始报价定价" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", { name: "商业与交付条款：请先开始报价定价" })
      .className,
  ).toContain("admin-quote-action-unavailable");
  expect(
    screen
      .getByRole("button", { name: "商业与交付条款：请先开始报价定价" })
      .parentElement?.getAttribute("title"),
  ).toBe("请先开始报价定价");
  expect(
    screen.getByRole("button", { name: "付款与到账：请先签发 PI" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", { name: "付款与到账：请先签发 PI" }).className,
  ).toContain("admin-quote-action-unavailable");
  expect(
    screen
      .getByRole("button", { name: "付款与到账：请先签发 PI" })
      .parentElement?.getAttribute("title"),
  ).toBe("请先签发 PI");
  expect(screen.getByRole("button", { name: "报价定价" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "PI 签发与查看" })).toBeTruthy();
});

it("links directly to terms after draft creation and payments after PI issuance", () => {
  showActions(true, true);
  expect(
    screen.getByRole("link", { name: "商业与交付条款" }).getAttribute("href"),
  ).toBe("/admin/quotes/request-1/terms");
  expect(
    screen.getByRole("link", { name: "付款与到账" }).getAttribute("href"),
  ).toBe("/admin/quotes/request-1/pi/payments");
});
