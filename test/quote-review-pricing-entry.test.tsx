// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, redirect, RouterProvider } from "react-router";
import type { ComponentProps } from "react";
import QuoteReviewDetail from "../app/modules/admin/routes/quote-review-detail";

afterEach(cleanup);

it("posts the start intent with one click instead of visiting an intermediate pricing page", async () => {
  const start = vi.fn();
  const props = {
    loaderData: {
      review: {
        id: "rfq-test",
        referenceNumber: "QR-TEST",
        submittedAt: "2026-09-21T00:00:00Z",
        snapshot: {},
        technicalReview: { state: "not_flagged", reasons: [] },
      },
      technical: {
        completion: null,
        snapshot: {},
        basis: "Submitted request",
        fingerprint: "test",
      },
    },
  } as unknown as ComponentProps<typeof QuoteReviewDetail>;
  const router = createMemoryRouter(
    [
      {
        path: "/admin/quotes/rfq-test",
        element: <QuoteReviewDetail {...props} />,
      },
      {
        path: "/admin/quotes/rfq-test/pricing",
        action: async ({ request }) => {
          start((await request.formData()).get("intent"));
          return redirect("/admin/quotes/rfq-test/pricing");
        },
        element: <h1>Pricing form</h1>,
      },
    ],
    { initialEntries: ["/admin/quotes/rfq-test"] },
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(screen.getByRole("button", { name: "报价定价" }));
  await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("start"));
  expect(
    await screen.findByRole("heading", { name: "Pricing form" }),
  ).toBeTruthy();
});
