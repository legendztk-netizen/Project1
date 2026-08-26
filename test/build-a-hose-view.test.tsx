// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../app/modules/catalog/domain/public-catalog";
import { BuildAHoseView } from "../app/modules/storefront/routes/build-a-hose";
import { publicHoseFixture } from "./fixtures/public-hose";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";

function renderPage(
  items: PublicCatalogItem[],
  options: { requestedEndASku?: string | null } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/build-a-hose"]}>
      <BuildAHoseView
        loaderData={{
          directSelection: { kind: "none" },
          families: groupCatalogFamilies(items),
          publishedHoseCount: items.length,
          releaseNumber: items[0]?.releaseNumber ?? null,
          requestedEndASku: options.requestedEndASku ?? null,
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
    const first = publicHoseFixture();
    const firstSelection = first.variantSelection;
    if (firstSelection?.kind !== "hose") throw new Error("Expected hose data");
    const second = publicHoseFixture({
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
    expect(
      screen.queryByRole("button", { name: "Continue to End A" }),
    ).toBeNull();

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
    expect(
      screen.getByRole("button", { name: "Continue to End A" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Select 1\/4 in/ }));
    expect(screen.getByText("SKU 601R1_002")).toBeTruthy();
    expect(screen.getByText("3260 psi / 225 bar")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("continues to guided End A results and stores the derived ferrule", async () => {
    const candidates = [
      compatibleEndAFixture(),
      compatibleEndAFixture({
        aliases: ["MP-04-04W"],
        compatibilityId: "COMP_0026",
        connectionStandard: "SAE J476 / ASME B1.20.3",
        displayName: "NPTF Male Fixed Straight Hose End",
        gender: "Male",
        hoseEndSku: "NPT_M_FX_04_04",
        interfaceFamily: "NPTF",
        interfaceGroup: "NPT / NPTF",
        sealingForm: "Tapered thread",
        swivelForm: "Fixed",
        thread: "1/4-18 NPTF",
      }),
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ candidates }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPage([publicHoseFixture()]);

    fireEvent.click(
      screen.getByRole("button", { name: /601R1 Hydraulic Hose/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Choose End A" }),
      ).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/configurator/compatible-end-a?hose=601R1_001",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(screen.getByText("2 of 2 compatible fittings")).toBeTruthy();

    fireEvent.change(
      screen.getByPlaceholderText("SKU, alias, thread, or dash"),
      {
        target: { value: "NPTF" },
      },
    );
    expect(screen.getByText("1 of 2 compatible fittings")).toBeTruthy();
    expect(screen.queryByText("SKU JIC_F_SW_04_04")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );
    expect(screen.getByText("End A selection ready")).toBeTruthy();
    expect(screen.getByText("601R1_1WB_002")).toBeTruthy();
    expect(screen.getByText(/not customer-selectable/)).toBeTruthy();
  });

  it("explains an invalid deep-linked End A after exact compatibility loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: [compatibleEndAFixture()] }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()], { requestedEndASku: "UNSUPPORTED_04" });
    fireEvent.click(
      screen.getByRole("button", { name: /601R1 Hydraulic Hose/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "This End A is not compatible with the selected hose.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/Requested SKU: UNSUPPORTED_04/)).toBeTruthy();
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
