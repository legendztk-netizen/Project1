// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { CustomerQuoteList } from "../app/modules/quote-request/ui/customer-quote-list";
import {
  customerQuoteProjection,
  type CustomerQuoteProgressCode,
} from "../app/modules/quote-request/domain/quote-request";

afterEach(cleanup);
function quote(code: CustomerQuoteProgressCode) {
  return customerQuoteProjection(
    {
      id: code,
      referenceNumber: `QR-${code}`,
      submittedAt: "2026-09-21T00:00:00Z",
      snapshot: {
        lines: [],
        amounts: { currency: "USD", merchandiseSubtotal: 120 },
        purchasingContext: { kind: "individual" },
        importResponsibility: { fulfillmentTerm: "DDP" },
      } as never,
    },
    code,
  );
}
const records = [
  "RFQ_SUBMITTED",
  "PI_ISSUED",
  "PI_ACCEPTED",
  "PI_EXPIRED",
  "PI_REPLACEMENT_REQUIRED",
].map((code) => quote(code as CustomerQuoteProgressCode));

it("filters immediately by status with accurate counts and restores all quotes", () => {
  render(
    <MemoryRouter>
      <CustomerQuoteList quoteRequests={records} />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(
    screen
      .getByRole("tab", { name: "All Quotes 5" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  for (const record of records) {
    fireEvent.click(
      screen.getByRole("tab", { name: `${record.progress.label} 1` }),
    );
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getAllByRole("article")).toHaveLength(1);
    expect(
      within(panel).getByRole("heading", { name: record.referenceNumber }),
    ).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("tab", { name: "All Quotes 5" }));
  expect(screen.getAllByRole("article")).toHaveLength(5);
});

it("supports keyboard navigation and empty status tabs", () => {
  render(
    <MemoryRouter>
      <CustomerQuoteList quoteRequests={[records[0]]} />
    </MemoryRouter>,
  );
  fireEvent.keyDown(screen.getByRole("tab", { name: "All Quotes 1" }), {
    key: "ArrowRight",
  });
  const submitted = screen.getByRole("tab", { name: "RFQ Submitted 1" });
  expect(document.activeElement).toBe(submitted);
  fireEvent.keyDown(submitted, { key: "ArrowRight" });
  expect(
    screen
      .getByRole("tab", { name: "PI Issued 0" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  expect(screen.getByText("No quotes in this status.")).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(
    screen
      .getByRole("tab", { name: "All Quotes 1" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});

it("keeps status tabs visible for an empty account", () => {
  render(
    <MemoryRouter>
      <CustomerQuoteList quoteRequests={[]} />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("tab")).toHaveLength(6);
  expect(screen.getByText("No submitted quote requests yet.")).toBeTruthy();
});

it("groups published quotes without a PI into RFQ Submitted", () => {
  const published = customerQuoteProjection({
    ...records[0],
    id: "published",
    hasCurrentOffer: true,
  });
  render(
    <MemoryRouter>
      <CustomerQuoteList quoteRequests={[records[0], published]} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("tab", { name: /Quote Ready/ })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "RFQ Submitted 2" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
});

it.each([
  ["PI_ISSUED", "PI total"],
  ["PI_ACCEPTED", "PI total"],
  ["PI_EXPIRED", "Expired PI total"],
  ["PI_REPLACEMENT_REQUIRED", "Previous PI total"],
] as const)(
  "shows the frozen PI total separately from submitted reference for %s",
  (code, label) => {
    const record = {
      ...quote(code),
      currentPi: {
        quoteRevisionId: "r1",
        currentQuoteRevisionId: "r1",
        validUntil: "2026-10-01",
        currency: "USD",
        totalCents: 25345,
      },
    };
    render(
      <MemoryRouter>
        <CustomerQuoteList quoteRequests={[record]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("USD 253.45")).toBeTruthy();
    expect(
      screen.getByText("Submitted merchandise reference: USD 120.00"),
    ).toBeTruthy();
  },
);

it.each([null, 0])(
  "does not replace a missing or zero PI total with a reference estimate (%s)",
  (totalCents) => {
    const record = {
      ...quote("PI_ISSUED"),
      currentPi: {
        quoteRevisionId: "r1",
        currentQuoteRevisionId: "r1",
        validUntil: "2026-10-01",
        currency: "USD",
        totalCents,
      },
    };
    render(
      <MemoryRouter>
        <CustomerQuoteList quoteRequests={[record]} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(totalCents === null ? "Not available" : "USD 0.00"),
    ).toBeTruthy();
  },
);
