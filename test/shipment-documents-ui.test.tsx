// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import CustomerShipmentDocuments from "../app/modules/customer-identity/routes/shipment-documents";

afterEach(cleanup);

describe("customer shipment documents", () => {
  it("downloads a shared file without navigating the client router", async () => {
    const path = "/account/orders/order-1/shipments/shipment-1/documents";
    const router = createMemoryRouter(
      [
        {
          id: "root",
          path: "/",
          element: <Outlet />,
          loader: () =>
            ({
              customer: { id: "customer-1", email: "buyer@example.com" },
            }) satisfies RootLoaderData,
          children: [
            {
              path: "account/orders/:orderId/shipments/:shipmentId/documents",
              element: (
                <CustomerShipmentDocuments
                  loaderData={{
                    orderId: "order-1",
                    shipmentId: "shipment-1",
                    documents: [
                      {
                        id: "document-1",
                        kind: "packing_list",
                        filename: "packing.pdf",
                        contentType: "application/pdf",
                        byteSize: 128,
                        visibility: "customer_shared",
                        version: 2,
                        createdAt: "2026-09-24T00:00:00.000Z",
                      },
                    ],
                    documentPage: 1,
                    hasMoreDocuments: false,
                  }}
                />
              ),
            },
          ],
        },
      ],
      { initialEntries: [path] },
    );

    render(<RouterProvider router={router} />);
    const download = await screen.findByRole("link", { name: "Download" });
    expect(download.getAttribute("href")).toBe(`${path}/document-1/download`);
    fireEvent.click(download);
    expect(router.state.location.pathname).toBe(path);
  });
});
