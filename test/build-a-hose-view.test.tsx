// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

import {
  groupCatalogFamilies,
  type PublicCatalogItem,
} from "../app/modules/catalog/domain/public-catalog";
import type { LengthMeasurementMethod } from "../app/modules/configurator-reference/domain/configurator-reference";
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
          measurementMethods: measurementMethodsFixture(),
          publishedHoseCount: items.length,
          releaseNumber: items[0]?.releaseNumber ?? null,
          requestedEndASku: options.requestedEndASku ?? null,
        }}
      />
    </MemoryRouter>,
  );
}

function measurementMethodsFixture(): LengthMeasurementMethod[] {
  return Array.from({ length: 7 }, (_, index) => {
    const code = `M0${index + 1}` as LengthMeasurementMethod["code"];
    return {
      code,
      diagramAssetKey: `${code}-diagram.png`,
      diagramAssetVersion: "diagram-1.0.1",
      displayName: `${code} measurement`,
      endpointRule: `${code} endpoint rule`,
      overlayVersion: "1.0.1",
      recordVersion: 2,
    };
  });
}

function compatibleCandidates() {
  return [
    compatibleEndAFixture(),
    compatibleEndAFixture({
      aliases: ["MP-04-04W"],
      compatibilityId: "COMP_0026",
      connectionStandard: "SAE J476 / ASME B1.20.3",
      displayName: "NPTF Male Fixed Straight Hose End",
      ferrule: {
        ...compatibleEndAFixture().ferrule,
        sku: "601R1_1WB_003",
      },
      gender: "Male",
      hoseEndSku: "NPT_M_FX_04_04",
      interfaceFamily: "NPTF",
      interfaceGroup: "NPT / NPTF",
      sealingForm: "Tapered thread",
      swivelForm: "Fixed",
      thread: "1/4-18 NPTF",
    }),
  ];
}

function chooseFixtureHose() {
  fireEvent.click(screen.getByRole("button", { name: /601R1 Hydraulic Hose/ }));
  fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));
}

async function reachFinishedLengthStage() {
  chooseFixtureHose();
  await screen.findByRole("heading", { name: "Choose End A" });
  fireEvent.click(
    screen.getByRole("button", {
      name: /Select JIC 37° Female Swivel 0° Straight Hose End/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue to End B" }));
  await screen.findByRole("heading", { name: "Choose End B" });
  fireEvent.click(screen.getByRole("button", { name: "Use Same as End A" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to Finished Length" }),
  );
}

function saveM04Length(value = "72") {
  fireEvent.click(screen.getByRole("button", { name: /M04 M04 measurement/ }));
  fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Finished Length" }));
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
    const candidates = compatibleCandidates();
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
      "/api/configurator/compatible-end-a?release=release-002&hose=601R1_001",
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
    expect(screen.getByText("601R1_1WB_003")).toBeTruthy();
    expect(screen.getByText(/not customer-selectable/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue to End B" }),
    ).toBeTruthy();
  });

  it("stores different End A and End B selections with their own compatibility", async () => {
    const candidates = compatibleCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    chooseFixtureHose();

    await screen.findByRole("heading", { name: "Choose End A" });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select JIC 37° Female Swivel 0° Straight Hose End/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to End B" }));

    await screen.findByRole("heading", { name: "Choose End B" });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );

    const endA = screen.getByRole("region", { name: "Selected End A" });
    const endB = screen.getByRole("region", { name: "Selected End B" });
    expect(within(endA).getByText("SKU JIC_F_SW_04_04")).toBeTruthy();
    expect(within(endA).getByText("601R1_1WB_002")).toBeTruthy();
    expect(within(endB).getByText("SKU NPT_M_FX_04_04")).toBeTruthy();
    expect(within(endB).getByText("601R1_1WB_003")).toBeTruthy();
    expect(screen.getByText("Both hose ends are ready")).toBeTruthy();
  });

  it("copies only an exact eligible End A and leaves later choices unset", async () => {
    const candidates = compatibleCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    chooseFixtureHose();

    await screen.findByRole("heading", { name: "Choose End A" });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select JIC 37° Female Swivel 0° Straight Hose End/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to End B" }));

    await screen.findByRole("heading", { name: "Choose End B" });
    fireEvent.click(screen.getByRole("button", { name: "Use Same as End A" }));

    expect(screen.getAllByText("SKU JIC_F_SW_04_04")).toHaveLength(3);
    const remaining = screen.getByRole("region", {
      name: "Remaining configuration",
    });
    expect(within(remaining).getAllByText("Not selected")).toHaveLength(3);
    expect(within(remaining).queryByText(/M0[1-8]/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to End A" }));
    expect(screen.getByRole("heading", { name: "Choose End A" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Selected End B" })).toBeTruthy();
  });

  it("requires an explicit measurement method before accepting finished length", async () => {
    const candidates = compatibleCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStage();

    expect(
      screen.getByRole("heading", {
        name: "Set Finished Overall Assembly Length",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Measurement Guide" })
        .at(-1)
        ?.getAttribute("href"),
    ).toBe("/assembly-measurement-guide");
    const lengthGroup = screen.getByRole("group", {
      name: "2. Enter Finished Length",
    }) as HTMLFieldSetElement;
    expect(lengthGroup.disabled).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /M04 M04 measurement/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(
      screen.getByRole("button", { name: /M04 M04 measurement/ }),
    );
    expect(lengthGroup.disabled).toBe(false);
    fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
      target: { value: "72" },
    });
    expect(screen.getByText("1828.8 mm")).toBeTruthy();
    expect(screen.getByText("± 1% (± 18.288 mm)")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Save Finished Length" }),
    );
    const summary = screen.getByText("M04 · M04 measurement").parentElement;
    expect(summary).toBeTruthy();
    expect(screen.getAllByText("72 in").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
      target: { value: "73" },
    });
    expect(screen.queryByText("72 in")).toBeNull();
  });

  it("preserves method and length when End B changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: compatibleCandidates() }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStage();
    saveM04Length();

    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );

    expect(screen.getByText("M04 · M04 measurement")).toBeTruthy();
    expect(screen.getByText("72 in")).toBeTruthy();
  });

  it("preserves End B, method, and length when End A changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: compatibleCandidates() }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStage();
    saveM04Length();

    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to End A" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );

    expect(screen.getByRole("region", { name: "Selected End B" })).toBeTruthy();
    expect(screen.getByText("M04 · M04 measurement")).toBeTruthy();
    expect(screen.getByText("72 in")).toBeTruthy();
  });

  it("stores Not Sure without assigning an M-code or diagram", async () => {
    const [candidate] = compatibleCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: [candidate] }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStage();
    fireEvent.click(screen.getByRole("button", { name: /Not Sure/ }));
    fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
      target: { value: "24" },
    });

    expect(screen.getByText("Manual Technical Review Required")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for Manual Review" }),
    );
    expect(screen.getByText("Not Sure · Manual Technical Review")).toBeTruthy();
    expect(
      screen.getByText("Not Sure · Manual Technical Review").textContent,
    ).not.toMatch(/M0[1-7]/);
  });

  it("does not offer Same as End A when the exact SKU is unavailable", async () => {
    const [jic, npt] = compatibleCandidates();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ candidates: [jic] }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ candidates: [npt] }),
        ok: true,
      });
    vi.stubGlobal("fetch", fetchMock);
    renderPage([publicHoseFixture()]);
    chooseFixtureHose();

    await screen.findByRole("heading", { name: "Choose End A" });
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select JIC 37° Female Swivel 0° Straight Hose End/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to End B" }));

    await screen.findByRole("heading", { name: "Choose End B" });
    expect(
      screen.queryByRole("button", { name: "Use Same as End A" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    ).toBeTruthy();
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

  it("returns to hose selection when no compatible End A is published", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: [] }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    fireEvent.click(
      screen.getByRole("button", { name: /601R1 Hydraulic Hose/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "No compatible End A fittings are published for this hose",
        }),
      ).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose another Hose" }),
    );
    expect(
      screen.getByRole("group", { name: "1. Choose a Hose Series" }),
    ).toBeTruthy();
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
