// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it } from "vitest";
import { CustomerShippingChangeActions } from "../app/modules/shipment/ui/customer-order-shipping-changes";

afterEach(cleanup);

type Props = Parameters<typeof CustomerShippingChangeActions>[0];

const destination = {
  recipientName: "Pat Buyer",
  addressLine1: "1 Main St",
  addressLine2: "",
  city: "Houston",
  stateProvince: "TX",
  postalCode: "77001",
  countryCode: "US",
} as Props["destination"];

function renderActions(shipments: Props["shipments"]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <CustomerShippingChangeActions
            shipments={shipments}
            destination={destination}
            commandId="command-1"
          />
        ),
      },
    ],
    { initialEntries: ["/"] },
  );
  render(<RouterProvider router={router} />);
}

const shipment = {
  id: "shipment-1",
  displayName: "Ship together",
  status: "planned",
  version: 3,
  held: false,
};

it("opens the address change form in a dialog from a top-level button", async () => {
  renderActions([shipment]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change delivery address" }),
  );
  expect(
    screen.getByRole("heading", { name: "Request a delivery address change" }),
  ).toBeTruthy();
  const checkbox = screen.getByRole("checkbox", { name: "Ship together" });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  expect(
    (screen.getByLabelText("Recipient") as HTMLInputElement).defaultValue,
  ).toBe("Pat Buyer");
  expect(
    screen.getByRole("button", { name: "Submit change request" }),
  ).toBeTruthy();
});

it("opens the shipping plan form without address fields", async () => {
  renderActions([shipment, { ...shipment, id: "shipment-2" }]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Change shipping plan" }),
  );
  expect(screen.queryByLabelText("Recipient")).toBeNull();
  expect(
    screen
      .getAllByRole("checkbox")
      .every((box) => !(box as HTMLInputElement).checked),
  ).toBe(true);
});

it("hides change actions once no shipment can be changed", async () => {
  renderActions([
    { ...shipment, status: "shipped" },
    { ...shipment, id: "held", held: true },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByRole("button")).toBeNull();
});
