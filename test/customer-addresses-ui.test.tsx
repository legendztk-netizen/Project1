// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import CustomerAccount from "../app/modules/customer-identity/routes/customer-account";

vi.mock("../app/modules/customer-identity/ui/account-workspace", () => ({
  AccountWorkspace: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

afterEach(cleanup);

const address = {
  id: "address-1",
  label: "Main warehouse",
  recipientName: "Morgan Buyer",
  recipientEmail: "buyer@example.com",
  recipientPhone: "+1 212 555 0109",
  addressLine1: "200 Park Avenue",
  addressLine2: "Suite 900",
  city: "New York",
  stateProvince: "NY",
  postalCode: "10166",
  countryCode: "US",
  isSelected: true,
};

function renderAddresses(addresses = [address]) {
  const loaderData = {
    view: "addresses",
    profile: { email: "buyer@example.com", fullName: "", phoneNumber: "" },
    addresses,
    editingAddress: null,
    saved: false,
  };
  const props = { loaderData, actionData: undefined } as unknown as Parameters<
    typeof CustomerAccount
  >[0];
  const router = createMemoryRouter(
    [
      {
        path: "/account",
        element: <CustomerAccount {...props} />,
      },
    ],
    { initialEntries: ["/account?view=addresses"] },
  );
  render(<RouterProvider router={router} />);
}

it("shows saved addresses as cards with the default marked", async () => {
  renderAddresses();
  const card = (
    await screen.findByRole("heading", { name: "Main warehouse" })
  ).closest("article")!;
  expect(within(card).getByText("Default for quotes")).toBeTruthy();
  expect(within(card).getByText("New York, NY 10166")).toBeTruthy();
  expect(
    within(card).queryByRole("button", { name: "Set as default" }),
  ).toBeNull();
});

it("adds an address in a dialog with a US state list and ZIP validation", async () => {
  renderAddresses([]);
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Add address" }))[0],
  );
  const state = screen.getByLabelText("State");
  expect(state.tagName).toBe("SELECT");
  expect(
    within(state).getByRole("option", { name: "Oregon (OR)" }),
  ).toBeTruthy();
  const zip = screen.getByLabelText("ZIP code");
  expect(zip.getAttribute("pattern")).toBe("[0-9]{5}(-?[0-9]{4})?");
  fireEvent.change(screen.getByLabelText("Country / region"), {
    target: { value: "CA" },
  });
  const province = screen.getByLabelText("State / province");
  expect(province.tagName).toBe("INPUT");
  expect(
    screen.getByLabelText("Postal code").getAttribute("pattern"),
  ).toBeNull();
});

it("opens the edit dialog with the saved values", async () => {
  renderAddresses();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("heading", { name: "Edit delivery address" }),
  ).toBeTruthy();
  expect(screen.getByLabelText("State")).toHaveProperty("value", "NY");
  expect(screen.getByLabelText("Street address")).toHaveProperty(
    "value",
    "200 Park Avenue",
  );
});
