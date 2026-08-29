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
import type {
  ClockingConvention,
  LengthMeasurementMethod,
} from "../app/modules/configurator-reference/domain/configurator-reference";
import { BuildAHoseView } from "../app/modules/storefront/routes/build-a-hose";
import { publicHoseFixture } from "./fixtures/public-hose";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";

function renderPage(
  items: PublicCatalogItem[],
  options: {
    clockingConvention?: ClockingConvention | null;
    requestedEndASku?: string | null;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/build-a-hose"]}>
      <BuildAHoseView
        loaderData={{
          assemblyEstimateSchedule: {
            assemblyServicePricePerStartedFootUsd: 0.5,
            assemblyServicePriceUsd: null,
            currency: "USD",
            ferrulePriceSource: "catalog_sales_offer",
            hoseEndPriceSource: "catalog_sales_offer",
            hosePriceSource: "catalog_sales_offer_per_ft",
            protectionPriceSource: "installed_protection_registry",
            recordVersion: 2,
          },
          clockingConvention:
            options.clockingConvention === undefined
              ? clockingConventionFixture()
              : options.clockingConvention,
          directSelection: { kind: "none" },
          families: groupCatalogFamilies(items),
          installedProtectionRules: [],
          installedProtections: [
            {
              availability: "available",
              code: "NONE",
              currency: "USD",
              isNoAdditionalProtection: true,
              publicName: "No additional installed protection",
              recordVersion: 2,
              referenceBasePriceUsd: 0,
              referenceInstallationPricePerStartedFootUsd: 0,
              referenceMaterialPricePerFootUsd: 0,
              referencePriceUsd: 0,
              specification: "No additional installed sleeve or guard",
            },
            {
              availability: "available",
              code: "NYLON",
              currency: "USD",
              isNoAdditionalProtection: false,
              publicName: "Nylon Protective Sleeving",
              recordVersion: 2,
              referenceBasePriceUsd: 8,
              referenceInstallationPricePerStartedFootUsd: 1,
              referenceMaterialPricePerFootUsd: 1.35,
              referencePriceUsd: null,
              specification: "Abrasion-resistant nylon sleeve",
            },
          ],
          measurementMethods: measurementMethodsFixture(),
          publishedHoseCount: items.length,
          quoteLineContext: null,
          quoteLineError: null,
          releaseNumber: items[0]?.releaseNumber ?? null,
          requestedEndASku: options.requestedEndASku ?? null,
        }}
      />
    </MemoryRouter>,
  );
}

function clockingConventionFixture(): ClockingConvention {
  return {
    acceptedMaximumDegrees: 359,
    acceptedMinimumDegrees: 0,
    code: "M08",
    measurementDirection: "clockwise",
    notSureOutcome: "manual_review",
    presets: [0, 45, 90, 135, 180, 225, 270, 315],
    recordVersion: 2,
    rendererVersion: "1.0.1",
    standardToleranceDegrees: 3,
    tighterToleranceOutcome: "manual_review",
    viewDirection: "end_a_toward_end_b",
    zeroReference: "end_b_at_6_oclock",
  };
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
      mediaKey: "NPTF-Male-Fixed-0° Straight",
      sealingForm: "Tapered thread",
      swivelForm: "Fixed",
      thread: "1/4-18 NPTF",
    }),
  ];
}

function angledCandidates() {
  return [
    compatibleEndAFixture({
      aliases: ["FJX45-04-04W"],
      angle: "45°",
      compatibilityId: "COMP_0045",
      displayName: "JIC 37° Female Swivel 45° Hose End",
      hoseEndSku: "JIC45_F_SW_04_04",
    }),
    compatibleEndAFixture({
      aliases: ["FJX90-04-04W"],
      angle: "90°",
      compatibilityId: "COMP_0090",
      displayName: "JIC 37° Female Swivel 90° Hose End",
      hoseEndSku: "JIC90_F_SW_04_04",
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

async function reachFinishedLengthStageWithEnds(
  endAName: RegExp,
  endBName?: RegExp,
) {
  chooseFixtureHose();
  await screen.findByRole("heading", { name: "Choose End A" });
  fireEvent.click(screen.getByRole("button", { name: endAName }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to End B" }));
  await screen.findByRole("heading", { name: "Choose End B" });
  if (endBName) {
    fireEvent.click(screen.getByRole("button", { name: endBName }));
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Use Same as End A" }));
  }
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to Finished Length" }),
  );
}

function saveM04Length(value = "72") {
  fireEvent.click(screen.getByRole("button", { name: /M04 M04 measurement/ }));
  fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
    target: { value },
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: /Save (Finished Length|for Manual Review)/,
    }),
  );
}

function saveNylonProtection() {
  fireEvent.click(
    screen.getByRole("button", { name: /Nylon Protective Sleeving/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));
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
    const previewToggle = screen.getByRole("button", {
      name: "View assembly preview",
    });
    const preview = document.getElementById("live-assembly-summary");
    expect(previewToggle.getAttribute("aria-expanded")).toBe("false");
    expect(preview?.getAttribute("data-mobile-open")).toBe("false");
    fireEvent.click(previewToggle);
    expect(
      screen.getByRole("button", { name: "Close assembly preview" }),
    ).toBeTruthy();
    expect(preview?.getAttribute("data-mobile-open")).toBe("true");
    expect(screen.getByText("3626 psi / 250 bar")).toBeTruthy();
    expect(screen.getByText("Hose selection ready")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Continue to End A" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Continue to End A" })
        .closest(".configurator-action-dock"),
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
    expect(screen.getByText("Matched ferrule included")).toBeTruthy();
    expect(screen.queryByText("601R1_1WB_003")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Continue to End B" }),
    ).toBeTruthy();
    const actions = screen.getByRole("region", {
      name: "Configuration actions",
    });
    const actionButtons = within(actions).getAllByRole("button");
    expect(actionButtons[0]).toBe(
      screen.getByRole("button", { name: "Back to Hose" }),
    );
    expect(actionButtons[1]).toBe(
      screen.getByRole("button", { name: "Continue to End B" }),
    );
    expect(actionButtons[0].classList.contains("configurator-back")).toBe(true);
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
    expect(screen.getByText("Need a single-ended assembly?")).toBeTruthy();
    expect(screen.getByText(/outside this guided configurator/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );

    const endA = screen.getByRole("region", { name: "Selected End A" });
    const endB = screen.getByRole("region", { name: "Selected End B" });
    expect(within(endA).getByText("SKU JIC_F_SW_04_04")).toBeTruthy();
    expect(within(endA).getByText("Matched ferrule included")).toBeTruthy();
    expect(within(endB).getByText("SKU NPT_M_FX_04_04")).toBeTruthy();
    expect(within(endB).getByText("Matched ferrule included")).toBeTruthy();
    expect(screen.queryByText("601R1_1WB_002")).toBeNull();
    expect(screen.queryByText("601R1_1WB_003")).toBeNull();
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
    expect(within(remaining).getAllByText("Not selected")).toHaveLength(2);
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
    expect(
      screen
        .getByRole("button", { name: "Save Finished Length" })
        .closest(".configurator-action-dock"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Save Finished Length" }),
    );
    const summary = screen.getByText("M04 · M04 measurement").parentElement;
    expect(summary).toBeTruthy();
    expect(screen.getAllByText("72 in").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Example: 72"), {
      target: { value: "73" },
    });
    expect(screen.queryByText("72 in")).toBeNull();
  });

  it("omits Clocking when fewer than two selected ends are angled", async () => {
    const candidates = [compatibleEndAFixture(), ...angledCandidates()];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel 0° Straight Hose End/,
      /Select JIC 37° Female Swivel 90° Hose End/,
    );

    saveM04Length();

    expect(
      screen.getByRole("heading", { name: "Choose installed protection" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Set Double-Elbow Clocking" }),
    ).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Assembly steps" })).queryByText(
        "Orientation",
      ),
    ).toBeNull();
  });

  it("saves installed protection and canonical application inputs with length-based pricing", async () => {
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

    expect(screen.getByText("Standard Export Packaging included")).toBeTruthy();
    expect(
      within(
        screen.getByRole("group", { name: "1. Installed Protection" }),
      ).queryByText("Standard Export Packaging included"),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Nylon Protective Sleeving/ }),
    );
    fireEvent.click(screen.getByText("2. Operating Conditions"));
    fireEvent.change(screen.getByLabelText("Fluid medium"), {
      target: { value: "petroleum_hydraulic_fluid" },
    });
    fireEvent.change(screen.getByLabelText("Maximum system working pressure"), {
      target: { value: "3000" },
    });
    fireEvent.change(screen.getByLabelText("Minimum operating temperature"), {
      target: { value: "-40" },
    });
    fireEvent.change(screen.getByLabelText("Maximum operating temperature"), {
      target: { value: "212" },
    });

    const pricing = screen.getByRole("region", {
      name: "Length-based reference pricing",
    });
    expect(within(pricing).getByText("$3.00")).toBeTruthy();
    expect(within(pricing).getByText("$22.10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));

    expect(
      screen.getByRole("heading", { name: "Review Your Assembly" }),
    ).toBeTruthy();
    expect(screen.getByText("Technical Review Required")).toBeTruthy();
    expect(
      screen.getAllByText("Nylon Protective Sleeving").length,
    ).toBeGreaterThan(0);
  });

  it("saves installed protection without optional operating conditions", async () => {
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

    expect(screen.getByText("Optional")).toBeTruthy();
    expect(
      screen
        .getByText("2. Operating Conditions")
        .closest("details")
        ?.hasAttribute("open"),
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: /Nylon Protective Sleeving/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));

    expect(
      screen.getByRole("heading", { name: "Review Your Assembly" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Operating conditions not provided (optional)")
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Nylon Protective Sleeving").length,
    ).toBeGreaterThan(0);
  });

  it("reviews ordered components, versions and exposes the configured Quote List command", async () => {
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
    saveNylonProtection();

    const review = screen.getByRole("region", { name: "Assembly review" });
    expect(within(review).getByText("Technical Review Required")).toBeTruthy();
    expect(within(review).getByText("601R1 Hydraulic Hose")).toBeTruthy();
    expect(
      within(review).getAllByText("Matched ferrule included"),
    ).toHaveLength(2);
    expect(
      within(review)
        .getByRole("button", { name: "Add Assembly to Quote" })
        .hasAttribute("disabled"),
    ).toBe(false);
    expect(
      within(review)
        .getByRole("img", {
          name: "End A: JIC 37° Female Swivel 0° Straight Hose End",
        })
        .getAttribute("src"),
    ).toBe("/images/catalog/hose-ends/jic-female-swivel-straight.jpg");
    expect(
      within(review)
        .getByRole("img", {
          name: "End B: JIC 37° Female Swivel 0° Straight Hose End",
        })
        .getAttribute("src"),
    ).toBe("/images/catalog/hose-ends/jic-female-swivel-straight.jpg");
    expect(screen.queryByText("601R1_1WB_002")).toBeNull();
    expect(within(review).getByText(/M04 · M04 measurement/)).toBeTruthy();
    expect(within(review).getByText("72 in")).toBeTruthy();
    expect(within(review).getByText(/1828.8 mm/)).toBeTruthy();
    expect(within(review).getByText("± 1% (± 18.288 mm)")).toBeTruthy();
    expect(within(review).getByText("Assembly estimate schedule")).toBeTruthy();
    expect(within(review).getByText("v2")).toBeTruthy();
    expect(
      (within(review).getByLabelText("Assembly quantity") as HTMLInputElement)
        .value,
    ).toBe("1");
    expect(screen.queryByRole("button", { name: /Add to Quote/ })).toBeNull();
  });

  it("blocks an invalid quantity and preserves the draft through linked corrections", async () => {
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
    saveNylonProtection();

    fireEvent.change(screen.getByLabelText("Assembly quantity"), {
      target: { value: "1.5" },
    });
    expect(screen.getByText("Configuration Blocked")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("whole number");

    fireEvent.click(screen.getByRole("button", { name: "Edit End B" }));
    expect(screen.getByRole("heading", { name: "Choose End B" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Return to Review" }));
    expect(screen.getAllByText("72 in").length).toBeGreaterThan(0);
    expect(
      (screen.getByLabelText("Assembly quantity") as HTMLInputElement).value,
    ).toBe("1.5");
  });

  it("explains unsupported length as a Manual Assembly Quote Request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: compatibleCandidates() }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStage();
    saveM04Length("601");
    saveNylonProtection();

    expect(screen.getByText("Manual Assembly Quote Request")).toBeTruthy();
    expect(screen.getAllByText(/over 50 ft/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/contact our team/i).length).toBeGreaterThan(0);
  });

  it("routes an unclassified Hose End angle to technical review without assuming M08", async () => {
    const candidates = [
      compatibleEndAFixture({
        angle: "Other",
        displayName: "JIC 37° Female Swivel Unclassified Angle Hose End",
        hoseEndSku: "JIC_OTHER_F_SW_04_04",
      }),
      ...angledCandidates(),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel Unclassified Angle Hose End/,
      /Select JIC 37° Female Swivel 90° Hose End/,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Orientation Technical Review Required",
    );
    expect(
      within(screen.getByRole("list", { name: "Assembly steps" })).queryByText(
        "Orientation",
      ),
    ).toBeNull();

    saveM04Length();

    expect(
      screen.queryByRole("heading", { name: "Set Double-Elbow Clocking" }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Choose installed protection" }),
    ).toBeTruthy();
  });

  it("explains a fail-closed M08 convention instead of silently hiding Save", async () => {
    const candidates = angledCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()], {
      clockingConvention: {
        ...clockingConventionFixture(),
        standardToleranceDegrees: 5,
      },
    });
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel 90° Hose End/,
    );

    saveM04Length();

    expect(screen.getByRole("alert").textContent).toContain(
      "published tolerance is not the required ±3°",
    );
    expect(screen.queryByRole("group", { name: "Choose an angle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Clocking" })).toBeNull();
    expect(
      within(
        screen.getByRole("region", { name: "Clocking actions" }),
      ).getByRole("button", { name: "Back to Finished Length" }),
    ).toBeTruthy();
  });

  it("requires explicit Clocking for two angled ends and renders M08 deterministically", async () => {
    const candidates = angledCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel 90° Hose End/,
    );

    saveM04Length();

    expect(
      screen.getByRole("heading", { name: "Set Double-Elbow Clocking" }),
    ).toBeTruthy();
    expect(screen.getByText("Orientation")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: /Double-elbow Clocking angle not selected/,
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Clocking" })).toBeNull();
    expect(screen.getByText("Not to scale")).toBeTruthy();
    expect(
      screen.getByText("View the assembly from End A toward End B."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "090°" }));

    expect(
      screen.getByRole("img", {
        name: /Double-elbow Clocking 090 degrees/,
      }),
    ).toBeTruthy();
    expect(screen.getByText("090° Clocking")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Clocking" }));
    expect(screen.getByText("090° · ±3°")).toBeTruthy();
  });

  it("validates Clocking boundaries and never turns Not Sure into an angle", async () => {
    const candidates = angledCandidates();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel 45° Hose End/,
    );
    saveM04Length();

    const input = screen.getByPlaceholderText("000–359");
    fireEvent.change(input, { target: { value: "360" } });
    expect(screen.getByRole("alert").textContent).toContain(
      "whole degree from 000 through 359",
    );
    expect(screen.queryByRole("button", { name: "Save Clocking" })).toBeNull();

    fireEvent.change(input, { target: { value: "359" } });
    expect(screen.getByText("359° Clocking")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: /Double-elbow Clocking 359 degrees/ }),
    ).toBeTruthy();

    fireEvent.change(input, { target: { value: "000" } });
    expect(screen.getByText("000° Clocking")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Not Sure/ }));
    expect(screen.getByText("Manual Technical Review Required")).toBeTruthy();
    expect(
      screen.getByRole("img", {
        name: /Double-elbow Clocking angle not selected/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("000° Clocking")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Save for Manual Review" }),
    );
    expect(screen.getByText("Not Sure · Manual Technical Review")).toBeTruthy();
  });

  it("retains saved Clocking as invalid after an upstream Hose End change", async () => {
    const candidates = [compatibleEndAFixture(), ...angledCandidates()];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates }),
        ok: true,
      }),
    );
    renderPage([publicHoseFixture()]);
    await reachFinishedLengthStageWithEnds(
      /Select JIC 37° Female Swivel 90° Hose End/,
    );
    saveM04Length();
    fireEvent.click(screen.getByRole("button", { name: "090°" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Clocking" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Select JIC 37° Female Swivel 0° Straight Hose End/,
      }),
    );

    expect(
      screen.getByText("Retained selection · Reconfirmation required"),
    ).toBeTruthy();
    expect(screen.getByText(/Previous Clocking: 090°/)).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Assembly steps" })).queryByText(
        "Orientation",
      ),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Finished Length" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save Finished Length" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /No additional installed protection/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));

    expect(screen.getByText("Configuration Blocked")).toBeTruthy();
    expect(screen.getAllByText(/Clocking is retained/).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Clocking" })[0],
    );
    expect(screen.queryAllByText(/Clocking is retained/)).toHaveLength(0);
    expect(screen.getByText("Technical Review Required")).toBeTruthy();
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

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
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

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
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

  it("retains every downstream selection, assigns issues by step, and clears them when the Hose is restored", async () => {
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
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({ candidates: compatibleCandidates() }),
        ok: true,
      }),
    );
    renderPage([first, second]);
    await reachFinishedLengthStage();
    saveM04Length();
    fireEvent.click(
      screen.getByRole("button", { name: /Nylon Protective Sleeving/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to Protection" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to End A" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Hose" }));
    fireEvent.click(screen.getByRole("button", { name: /Select 1\/4 in/ }));

    expect(screen.getByRole("region", { name: "Selected End A" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Selected End B" })).toBeTruthy();
    expect(screen.getByText("M04 · M04 measurement")).toBeTruthy();
    expect(screen.getByText("72 in")).toBeTruthy();
    expect(screen.getAllByText("Nylon Protective Sleeving")).toHaveLength(1);
    const notice = screen.getByRole("region", {
      name: "Configuration validation issues",
    });
    expect(notice.textContent).toContain("Nothing has been removed");
    expect(notice.textContent).toContain("End A");
    expect(notice.textContent).toContain("End B");
    expect(notice.textContent).toContain("Finished Length");
    expect(notice.textContent).toContain("Protection");

    fireEvent.click(screen.getByRole("button", { name: /Select 3\/16 in/ }));
    const restoredNotice = screen.getByRole("region", {
      name: "Configuration validation issues",
    });
    expect(restoredNotice.textContent).not.toContain("Reconfirmation required");
    expect(restoredNotice.textContent).toContain("Technical review");
    expect(screen.getByRole("region", { name: "Selected End A" })).toBeTruthy();
    expect(screen.getByText("72 in")).toBeTruthy();
  });

  it("keeps an incompatible retained End visible until the customer replaces it", async () => {
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
      },
    });
    const fetchMock = vi.fn().mockImplementation(async (request: string) => ({
      json: async () => ({
        candidates: request.includes("hose=601R1_002")
          ? []
          : compatibleCandidates(),
      }),
      ok: true,
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage([first, second]);
    await reachFinishedLengthStage();

    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to End A" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Hose" }));
    fireEvent.click(screen.getByRole("button", { name: /Select 1\/4 in/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Configuration validation issues" })
          .textContent,
      ).toContain("not an exact current combination"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));

    expect(
      await screen.findByText(
        "Retained End A is not valid for the current Hose.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/SKU JIC_F_SW_04_04 remains visible/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Selected End A" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Continue to End B" }),
    ).toBeNull();
    expect(screen.queryByText("End A selection ready")).toBeNull();
  });

  it("clears only the replaced invalid End issue and preserves unrelated values", async () => {
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
      },
    });
    const replacement = compatibleCandidates()[1];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (request: string) => ({
        json: async () => ({
          candidates: request.includes("hose=601R1_002")
            ? [replacement]
            : compatibleCandidates(),
        }),
        ok: true,
      })),
    );
    renderPage([first, second]);
    await reachFinishedLengthStage();
    saveM04Length();
    fireEvent.click(
      screen.getByRole("button", { name: /Nylon Protective Sleeving/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Protection" }));

    fireEvent.click(screen.getByRole("button", { name: "Back to Protection" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Back to Finished Length" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to End B" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to End A" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to Hose" }));
    fireEvent.click(screen.getByRole("button", { name: /Select 1\/4 in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to End A" }));

    expect(
      await screen.findByText(
        "Retained End A is not valid for the current Hose.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Select NPTF Male Fixed Straight Hose End/,
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Configuration validation issues" })
          .textContent,
      ).not.toContain("End A JIC_F_SW_04_04"),
    );
    expect(
      screen.getByRole("button", { name: "Continue to End B" }),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Selected End A" })).getByText(
        "SKU NPT_M_FX_04_04",
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Selected End B" })).getByText(
        "SKU JIC_F_SW_04_04",
      ),
    ).toBeTruthy();
    expect(screen.getByText("72 in")).toBeTruthy();
    expect(screen.getAllByText("Nylon Protective Sleeving")).toHaveLength(1);
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

    fireEvent.click(screen.getByRole("button", { name: "Back to Hose" }));
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
