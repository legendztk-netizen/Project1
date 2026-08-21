export type CatalogFamilyId =
  | "hydraulic-hose"
  | "hose-ends"
  | "ferrules"
  | "adapters"
  | "quick-couplers";

export interface CatalogFamilySummary {
  description: string;
  id: CatalogFamilyId;
  label: string;
}

export const catalogSetupStatus = "Preparing catalog";
export const initialCatalogFamilyId: CatalogFamilyId = "hydraulic-hose";

export const launchCatalogFamilies: CatalogFamilySummary[] = [
  {
    id: "hydraulic-hose",
    label: "Hydraulic Hose",
    description: "Six launch series with pressure and size variants.",
  },
  {
    id: "hose-ends",
    label: "Hose Ends",
    description: "JIC, NPT/NPTF, ORFS, BSPP and BSPT connections.",
  },
  {
    id: "ferrules",
    label: "Ferrules",
    description: "Construction-matched crimp ferrules.",
  },
  {
    id: "adapters",
    label: "Adapters",
    description: "North American transition fitting combinations.",
  },
  {
    id: "quick-couplers",
    label: "Quick Couplers",
    description: "Common interchange standards and body sizes.",
  },
];
