// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MemoryRouter } from "react-router";
import { CustomerQuoteNavigation } from "../app/modules/customer-identity/ui/customer-quote-navigation";

afterEach(cleanup);

it("switches between quote sections and marks only the current page", () => {
  render(
    <MemoryRouter initialEntries={["/account/quotes/request-1"]}>
      <CustomerQuoteNavigation requestId="request-1" />
    </MemoryRouter>,
  );
  const overview = screen.getByRole("link", { name: "Overview" });
  const conversation = screen.getByRole("link", { name: "Quote conversation" });
  const pi = screen.getByRole("link", { name: "Proforma invoice" });
  expect(overview.getAttribute("aria-current")).toBe("page");
  expect(overview.getAttribute("href")).toBe("/account/quotes/request-1");
  expect(conversation.getAttribute("aria-current")).toBeNull();
  expect(pi.getAttribute("aria-current")).toBeNull();
  expect(conversation.getAttribute("href")).toBe(
    "/account/quotes/request-1/conversation",
  );
  expect(pi.getAttribute("href")).toBe("/account/quotes/request-1/pi");
  fireEvent.click(conversation);
  expect(overview.getAttribute("aria-current")).toBeNull();
  expect(conversation.getAttribute("aria-current")).toBe("page");
  expect(pi.getAttribute("aria-current")).toBeNull();
  fireEvent.click(pi);
  expect(conversation.getAttribute("aria-current")).toBeNull();
  expect(pi.getAttribute("aria-current")).toBe("page");
});

it("keeps the PI section active when viewing a specific invoice", () => {
  render(
    <MemoryRouter initialEntries={["/account/quotes/request-1/pi/invoice-2"]}>
      <CustomerQuoteNavigation requestId="request-1" />
    </MemoryRouter>,
  );
  expect(
    screen
      .getByRole("link", { name: "Proforma invoice" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
