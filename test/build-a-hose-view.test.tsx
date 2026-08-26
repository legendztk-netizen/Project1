// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../app/modules/catalog/domain/public-catalog";
import { BuildAHoseView } from "../app/modules/storefront/routes/build-a-hose";

function hose(overrides: Partial<PublicCatalogItem> = {}): PublicCatalogItem {
  return {
    aliases: ["SAE 100 R1AT"],
    canAddToQuote: true,
    category: "hydraulic-hose",
    displayName: "601R1 Hydraulic Hose -3",
    familyKey: "601r1",
    familyName: "601R1 Hydraulic Hose",
    interfaceGroup: null,
    mediaKey: "601R1",
    offer: {
      currency: "USD",
      leadTimeDays: 10,
      lengthOrdering: null,
      madeToOrder: false,
      moq: 1,
      referencePrice: 1.25,
      salesUnit: "ft",
    },
    productType: "hose",
    releaseId: "release-002",
    releaseNumber: "CAT-002",
    rfqEligibility: "Eligible",
    sku: "601R1_001",
    specs: [],
    supplyAvailability: "available_for_quote",
    variantSelection: {
      dash: "-3",
      equivalentStandard: "EN 853 1SN",
      hoseSeries: "601R1",
      kind: "hose",
      nominalIdIn: 0.1875,
      performance: {
        temperatureMaxC: 100,
        temperatureMinC: -40,
        workingBar: 250,
        workingPsi: 3626,
      },
      primaryStandard: "SAE 100 R1AT",
      reinforcement: "Single wire braid",
    },
    ...overrides,
  };
}

function renderPage(items: PublicCatalogItem[]) {
  return render(
    <MemoryRouter initialEntries={["/build-a-hose"]}>
      <BuildAHoseView
        loaderData={{
          directSelection: { kind: "none" },
          families: groupCatalogFamilies(items),
          publishedHoseCount: items.length,
          releaseNumber: items[0]?.releaseNumber ?? null,
        }}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Build a Hose view", () => {
  it("hydrates a page-session draft only after exact series and size clicks", () => {
    const first = hose();
    const firstSelection = first.variantSelection;
    if (firstSelection?.kind !== "hose") throw new Error("Expected hose data");
    const second = hose({
      displayName: "601R1 Hydraulic Hose -4",
      sku: "601R1_002",
      variantSelection: {
        ...firstSelection,
        dash: "-4",
        nominalIdIn: 0.25,
        performance: {
          ...firstSelection.performance,
          workingBar: 225,
          workingPsi: 3260,
        },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderPage([first, second]);

    expect(
      screen.queryByRole("group", { name: "2. Choose Hose Inside Diameter" }),
    ).toBeNull();
    expect(screen.queryByText("Hose selection ready")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /601R1 Hydraulic Hose/ }),
    );
    expect(
      screen.getByRole("group", { name: "2. Choose Hose Inside Diameter" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
    expect(screen.getByText("SKU 601R1_001")).toBeTruthy();
    expect(screen.getByText("3626 psi / 250 bar")).toBeTruthy();
    expect(screen.getByText("Hose selection ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Select 1\/4 in/ }));
    expect(screen.getByText("SKU 601R1_002")).toBeTruthy();
    expect(screen.getByText("3260 psi / 225 bar")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains what to do when the active release has no published hoses", () => {
    renderPage([]);

    expect(
      screen.getByRole("heading", { name: "No published hydraulic hoses" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Browse hydraulic hose" })
        .getAttribute("href"),
    ).toBe("/catalog/hydraulic-hose");
  });
});
