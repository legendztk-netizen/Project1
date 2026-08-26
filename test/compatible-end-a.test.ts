import { describe, expect, it } from "vitest";

import {
  attachEndAToDraft,
  attachEndBToDraft,
  exactSameHoseEndCandidate,
  filterCompatibleEndACandidates,
} from "../app/modules/configurator/domain/compatible-end-a";
import { createHoseConfigurationDraft } from "../app/modules/configurator/domain/hose-configuration-draft";
import { compatibleEndAFixture } from "./fixtures/compatible-end-a";
import { publicHoseFixture } from "./fixtures/public-hose";

describe("compatible End A candidates", () => {
  const candidates = [
    compatibleEndAFixture(),
    compatibleEndAFixture({
      aliases: ["FBSPX90-04-04W"],
      angle: "90°",
      compatibilityId: "COMP_0006",
      connectionStandard: "ISO 1179 / ISO 228-1",
      displayName: "BSPP Female Swivel 90° Hose End",
      hoseEndSku: "BSPP90_F_SW_04_04",
      interfaceFamily: "BSPP",
      interfaceGroup: "BSPP / BSPT",
      sealingForm: "60° cone seat",
      thread: "G 1/4-19",
    }),
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

  it("filters exact candidates by customer-readable fields", () => {
    expect(
      filterCompatibleEndACandidates(candidates, {
        angle: "90°",
        connectionDash: "-4",
        gender: "Female",
        interfaceGroup: "BSPP / BSPT",
        query: "",
        swivelForm: "Swivel",
      }).map((candidate) => candidate.hoseEndSku),
    ).toEqual(["BSPP90_F_SW_04_04"]);
  });

  it("searches only the supplied compatible set by SKU, alias, thread, and dash", () => {
    expect(
      filterCompatibleEndACandidates(candidates, { query: "FJX-04" }).map(
        (candidate) => candidate.hoseEndSku,
      ),
    ).toEqual(["JIC_F_SW_04_04"]);
    expect(
      filterCompatibleEndACandidates(candidates, { query: "1/4-18 NPTF" }).map(
        (candidate) => candidate.hoseEndSku,
      ),
    ).toEqual(["NPT_M_FX_04_04"]);
    expect(
      filterCompatibleEndACandidates(candidates, { query: "-4" }),
    ).toHaveLength(3);
    expect(
      filterCompatibleEndACandidates(candidates, { query: "UNSUPPORTED_04" }),
    ).toEqual([]);
  });

  it("keeps precise standards separate inside a shared interface group", () => {
    const npt = compatibleEndAFixture({
      compatibilityId: "COMP_NPT",
      connectionStandard: "ASME B1.20.1",
      hoseEndSku: "NPT_M_FX_04_04",
      interfaceFamily: "NPT",
      interfaceGroup: "NPT / NPTF",
      thread: "1/4-18 NPT",
    });
    const nptf = compatibleEndAFixture({
      compatibilityId: "COMP_NPTF",
      connectionStandard: "SAE J476 / ASME B1.20.3",
      hoseEndSku: "NPTF_M_FX_04_04",
      interfaceFamily: "NPTF",
      interfaceGroup: "NPT / NPTF",
      thread: "1/4-18 NPTF",
    });

    expect(
      filterCompatibleEndACandidates([npt, nptf], { query: "NPTF" }).map(
        (candidate) => candidate.hoseEndSku,
      ),
    ).toEqual(["NPTF_M_FX_04_04"]);
  });

  it("snapshots the exact compatibility, Hose End, and derived Ferrule", () => {
    const draft = createHoseConfigurationDraft(publicHoseFixture());
    if (!draft) throw new Error("Expected hose draft");

    expect(attachEndAToDraft(draft, candidates[0])).toMatchObject({
      endA: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: {
          connectionStandard: "SAE J514 / ISO 8434-2",
          sku: "JIC_F_SW_04_04",
          thread: "7/16-20 UNF",
        },
      },
      hose: { sku: "601R1_001" },
    });
  });

  it("keeps End A and End B as ordered component roles", () => {
    const base = createHoseConfigurationDraft(publicHoseFixture());
    if (!base) throw new Error("Expected hose draft");
    const withEndA = attachEndAToDraft(base, candidates[0]);
    const complete = attachEndBToDraft(withEndA, candidates[2]);

    expect(complete).toMatchObject({
      endA: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "JIC_F_SW_04_04" },
      },
      endB: {
        compatibilityId: "COMP_0026",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "NPT_M_FX_04_04" },
      },
    });
  });

  it("offers an exact End A copy but rejects a same-Dash approximation", () => {
    expect(exactSameHoseEndCandidate(candidates, candidates[0])).toBe(
      candidates[0],
    );
    expect(
      exactSameHoseEndCandidate([candidates[1], candidates[2]], candidates[0]),
    ).toBeNull();
  });

  it("stores identical Hose Ends as separate ordered snapshots", () => {
    const base = createHoseConfigurationDraft(publicHoseFixture());
    if (!base) throw new Error("Expected hose draft");
    const complete = attachEndBToDraft(
      attachEndAToDraft(base, candidates[0]),
      candidates[0],
    );

    expect(complete.endA).not.toBe(complete.endB);
    expect(complete.endA?.hoseEnd.sku).toBe("JIC_F_SW_04_04");
    expect(complete.endB?.hoseEnd.sku).toBe("JIC_F_SW_04_04");
    expect(complete.endA?.compatibilityId).toBe("COMP_0011");
    expect(complete.endB?.compatibilityId).toBe("COMP_0011");
  });
});
