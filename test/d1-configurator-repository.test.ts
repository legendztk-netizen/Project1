import { describe, expect, it, vi } from "vitest";

import {
  compatibleHoseEndCandidateFromRow,
  createD1ConfiguratorRepository,
} from "../app/modules/configurator/infrastructure/d1-configurator-repository";

const row = {
  angle: "0° Straight",
  assembly_working_bar: 250,
  compatibility_id: "COMP_0011",
  competitor_part_number: "FJX-04-04W",
  connection_dash: "04",
  connection_standard: "SAE J514 / ISO 8434-2",
  ferrule_hose_construction: "1-wire braid",
  ferrule_hose_tail_dash: "04",
  ferrule_series: "601R1",
  ferrule_skive_requirement: "Other",
  ferrule_sku: "601R1_1WB_002",
  gender: "Female",
  hose_end_sku: "JIC_F_SW_04_04",
  hose_tail_dash: "04",
  interface_family: "JIC 37°",
  max_working_bar: 300,
  sealing_form: "37° cone seat",
  swivel_form: "Swivel",
  thread: "7/16-20 UNF",
};

describe("D1 configurator repository", () => {
  it("maps exact compatibility rows without collapsing standards", () => {
    expect(compatibleHoseEndCandidateFromRow(row)).toMatchObject({
      compatibilityId: "COMP_0011",
      assemblyWorkingBar: 250,
      connectionDash: "-4",
      connectionStandard: "SAE J514 / ISO 8434-2",
      ferrule: { hoseTailDash: "-4", sku: "601R1_1WB_002" },
      hoseEndSku: "JIC_F_SW_04_04",
      interfaceFamily: "JIC 37°",
      interfaceGroup: "JIC 37°",
      maximumWorkingBar: 300,
      thread: "7/16-20 UNF",
    });
  });

  it("treats blank imported pressure limits as unavailable", () => {
    expect(
      compatibleHoseEndCandidateFromRow({
        ...row,
        assembly_working_bar: "",
        max_working_bar: "",
      }),
    ).toMatchObject({
      assemblyWorkingBar: null,
      maximumWorkingBar: null,
    });
  });

  it("queries only exact eligible tuples and all three available components", async () => {
    const all = vi.fn().mockResolvedValue({ results: [row] });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const database = { prepare } as unknown as D1Database;

    const result = await createD1ConfiguratorRepository(
      database,
    ).findCompatibleEndA("catalog-release-7", "601R1_002");

    expect(bind).toHaveBeenCalledWith("catalog-release-7", "601R1_002");
    expect(result).toHaveLength(1);
    const sql = prepare.mock.calls[0]?.[0] as string;
    expect(sql).not.toContain("catalog_active_release");
    expect(sql).toContain("r.id = ?");
    expect(sql).toContain("r.status IN ('published', 'superseded')");
    expect(sql).toContain("c.hose_sku = ?");
    expect(sql).toContain("c.catalog_publication_status = 'Published'");
    expect(sql).toContain("c.rfq_eligibility = 'Eligible'");
    expect(sql).toContain("c.assembly_working_bar");
    expect(sql).toContain("e.max_working_bar");
    expect(sql).toContain("catalog_hose_ends e");
    expect(sql).toContain("catalog_ferrules f");
    expect(
      sql.match(/supply_availability = 'available_for_quote'/g),
    ).toHaveLength(3);
  });
});
