import type { CompatibleHoseEndCandidate } from "../../app/modules/configurator/domain/compatible-end-a";

export function compatibleEndAFixture(
  overrides: Partial<CompatibleHoseEndCandidate> = {},
): CompatibleHoseEndCandidate {
  return {
    aliases: ["FJX-04-04W", "7/16-20 UNF", "-4"],
    angle: "0° Straight",
    assemblyWorkingBar: 250,
    compatibilityId: "COMP_0011",
    connectionDash: "-4",
    connectionStandard: "SAE J514 / ISO 8434-2",
    displayName: "JIC 37° Female Swivel 0° Straight Hose End",
    ferrule: {
      hoseConstruction: "1-wire braid",
      hoseTailDash: "-4",
      series: "601R1",
      skiveRequirement: "Other",
      sku: "601R1_1WB_002",
    },
    gender: "Female",
    hoseEndSku: "JIC_F_SW_04_04",
    hoseTailDash: "-4",
    interfaceFamily: "JIC 37°",
    interfaceGroup: "JIC 37°",
    maximumWorkingBar: 300,
    mediaKey: "JIC 37°-Female-Swivel-0° Straight",
    sealingForm: "37° cone seat",
    swivelForm: "Swivel",
    thread: "7/16-20 UNF",
    ...overrides,
  };
}
