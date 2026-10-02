import { describe, expect, it } from "vitest";
import { scopedAssemblyCombinationsSql } from "../app/modules/configurator/infrastructure/scoped-assembly-combinations-sql";

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
  fitting_series: "FJX",
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
      mediaKey: "JIC 37°-Female-Swivel-0° Straight",
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

  it("keeps NPSM, Code 61, and long or medium 90 degree ends distinct", () => {
    expect(
      compatibleHoseEndCandidateFromRow({
        ...row,
        connection_standard: "NPSM / ASME B1.20.1",
        fitting_series: "FPX",
        interface_family: "NPT",
      }),
    ).toMatchObject({
      displayName: "NPSM Female Swivel 0° Straight Hose End",
      interfaceFamily: "NPSM",
      interfaceGroup: "NPT / NPTF",
    });

    expect(
      compatibleHoseEndCandidateFromRow({
        ...row,
        fitting_series: "C6190",
        gender: "N/A",
        interface_family: "SAE Flange",
      }),
    ).toMatchObject({
      displayName: "SAE Code 61 Swivel 0° Straight Hose End",
      interfaceFamily: "SAE Code 61",
      interfaceGroup: "SAE Flange",
    });

    expect(
      compatibleHoseEndCandidateFromRow({
        ...row,
        angle: "90°",
        fitting_series: "FJX90L",
      }).displayName,
    ).toBe("JIC 37° Female Swivel 90° Long Hose End");
    expect(
      compatibleHoseEndCandidateFromRow({
        ...row,
        angle: "90°",
        fitting_series: "FFX90M",
        interface_family: "ORFS",
      }).displayName,
    ).toBe("ORFS Female Swivel 90° Medium Hose End");
  });

  // End A options come from several small reads; these fake their results by table and check the rules.
  function fakeDatabase(overrides: Record<string, unknown[]> = {}) {
    const listed = {
      catalog_publication_status: "Published",
      rfq_eligibility: "Eligible",
    };
    const available = { ...listed, supply_availability: "available_for_quote" };
    const compatibility = (id: string, end: string) => ({
      ...listed,
      compatibility_id: id,
      hose_sku: "601R1_002",
      hose_end_sku: end,
      ferrule_sku: "601R1_1WB_002",
      assembly_working_bar: 250,
    });
    const combination = (a: string, endA: string, b: string, endB: string) => ({
      release_id: "catalog-release-7",
      hose_sku: "601R1_002",
      identity: JSON.stringify([
        "601R1_002",
        endA,
        "601R1_1WB_002",
        endB,
        "601R1_1WB_002",
      ]),
      end_a_compatibility_id: a,
      end_a_hose_end_sku: endA,
      end_a_ferrule_sku: "601R1_1WB_002",
      end_b_compatibility_id: b,
      end_b_hose_end_sku: endB,
      end_b_ferrule_sku: "601R1_1WB_002",
    });
    const end = (sku: string, series: string, dash: string) => ({
      ...row,
      sku,
      fitting_series: series,
      connection_dash: dash,
    });
    const tables: Record<string, unknown[]> = {
      catalog_releases: [{ status: "published" }],
      catalog_runtime_assembly_combinations: [
        combination("C1", "JIC_04", "C2", "ORFS_04"),
        combination("C3", "JIC_08", "C3", "JIC_08"),
      ],
      catalog_runtime_compatibilities: [
        compatibility("C1", "JIC_04"),
        compatibility("C2", "ORFS_04"),
        compatibility("C3", "JIC_08"),
        compatibility("C4", "JIC_12"),
      ],
      catalog_runtime_skus: [
        { ...available, sku: "601R1_002", product_type: "hose" },
        { ...available, sku: "601R1_1WB_002", product_type: "ferrule" },
        ...["JIC_04", "ORFS_04", "JIC_08", "JIC_12"].map((sku) => ({
          ...available,
          sku,
          product_type: "hose_end",
        })),
      ],
      catalog_item_unavailable_hoses: [],
      catalog_assembly_exclusions: [],
      catalog_runtime_hose_ends: [
        end("JIC_04", "FJX", "04"),
        end("ORFS_04", "FFX", "04"),
        end("JIC_08", "FJX", "08"),
        end("JIC_12", "FJX", "12"),
      ],
      catalog_runtime_hose_end_series: [
        { ...row, series_code: "FJX", interface_family: "JIC 37°" },
        { ...row, series_code: "FFX", interface_family: "ORFS" },
      ],
      catalog_runtime_ferrules: [
        {
          sku: "601R1_1WB_002",
          ferrule_series: "601R1",
          hose_construction: "1-wire braid",
          hose_tail_dash: "04",
          skive_requirement: "Other",
        },
      ],
      ...overrides,
    };
    const tableOf = (sql: string) =>
      sql === scopedAssemblyCombinationsSql
        ? "catalog_runtime_assembly_combinations"
        : Object.keys(tables)
            .filter((name) => sql.includes(`FROM ${name}`))
            .sort(
              (x, y) => sql.indexOf(`FROM ${x}`) - sql.indexOf(`FROM ${y}`),
            )[0];
    const binds: unknown[][] = [];
    const statement = (sql: string) => ({
      sql,
      bind(...values: unknown[]) {
        binds.push(values);
        return this;
      },
    });
    return {
      binds,
      database: {
        prepare: statement,
        async batch(statements: Array<{ sql: string }>) {
          return statements.map(({ sql }) => ({
            results: tables[tableOf(sql)] ?? [],
          }));
        },
      } as unknown as D1Database,
    };
  }
  const endA = (database: D1Database) =>
    createD1ConfiguratorRepository(database).findCompatibleEndA(
      "catalog-release-7",
      "601R1_002",
    );

  it("lists the ends of available assemblies of the requested release, in catalog order", async () => {
    const { database, binds } = fakeDatabase();
    const result = await endA(database);
    expect(binds).toContainEqual(["catalog-release-7", "601R1_002"]);
    // C4 is compatible but occurs in no assembly; ORFS sorts after JIC.
    expect(result.map((end) => end.compatibilityId)).toEqual([
      "C1",
      "C3",
      "C2",
    ]);
    expect(result[0]).toMatchObject({
      assemblyWorkingBar: 250,
      maximumWorkingBar: 300,
    });
  });

  it("drops assemblies whose release, components, listing or exclusion make them unavailable", async () => {
    expect(
      await endA(
        fakeDatabase({ catalog_releases: [{ status: "draft" }] }).database,
      ),
    ).toEqual([]);
    expect(
      await endA(
        fakeDatabase({ catalog_item_unavailable_hoses: [{ blocked: 1 }] })
          .database,
      ),
    ).toEqual([]);
    const unavailableEnd = fakeDatabase();
    const skus = (
      await unavailableEnd.database.batch([
        { sql: "FROM catalog_runtime_skus" } as never,
      ])
    )[0].results as Array<Record<string, unknown>>;
    skus.find((sku) => sku.sku === "ORFS_04")!.supply_availability =
      "temporarily_unavailable";
    // ORFS_04 is no longer available, so the C1+C2 assembly and both of its ends drop out.
    expect(
      (await endA(unavailableEnd.database)).map((end) => end.compatibilityId),
    ).toEqual(["C3"]);
    const excluded = fakeDatabase({
      catalog_assembly_exclusions: [
        {
          identity: JSON.stringify([
            "601R1_002",
            "JIC_08",
            "601R1_1WB_002",
            "JIC_08",
            "601R1_1WB_002",
          ]),
        },
      ],
    });
    expect(
      (await endA(excluded.database)).map((end) => end.compatibilityId),
    ).toEqual(["C1", "C2"]);
  });
});
