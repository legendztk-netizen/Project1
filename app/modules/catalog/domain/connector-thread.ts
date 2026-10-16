import type { DashSize } from "./dash-size";

// JIC 37° and ORB use the same thread for each Dash size in the chart below.
const jicOrbThreads: Partial<Record<DashSize, string>> = {
  "-2": "5/16-24 UNF",
  "-3": "3/8-24 UNF",
  "-4": "7/16-20 UNF",
  "-5": "1/2-20 UNF",
  "-6": "9/16-18 UNF",
  "-8": "3/4-16 UNF",
  "-10": "7/8-14 UNF",
  "-12": "1-1/16-12 UN",
  "-14": "1-3/16-12 UN",
  "-16": "1-5/16-12 UN",
  "-20": "1-5/8-12 UN",
  "-24": "1-7/8-12 UN",
  "-32": "2-1/2-12 UN",
};

/**
 * Adapter End Threads by interface and Dash size (ADR 0057), as in the Hydraulax "Fluid Port and Connector
 * Thread Sizes" chart (catalog p.158) and written the way Hose End threads are stored (`7/16-20 UNF`).
 */
const connectorThreads: Record<string, Partial<Record<DashSize, string>>> = {
  JIC: jicOrbThreads,
  ORB: jicOrbThreads,
  NPT: {
    "-2": "1/8-27 NPTF",
    "-4": "1/4-18 NPTF",
    "-6": "3/8-18 NPTF",
    "-8": "1/2-14 NPTF",
    "-12": "3/4-14 NPTF",
    "-16": "1-11.5 NPTF",
    "-20": "1-1/4-11.5 NPTF",
    "-24": "1-1/2-11.5 NPTF",
    "-32": "2-11.5 NPTF",
  },
  ORFS: {
    "-4": "9/16-18 UNF",
    "-6": "11/16-16 UN",
    "-8": "13/16-16 UN",
    "-10": "1-14 UNS",
    "-12": "1-3/16-12 UN",
    "-16": "1-7/16-12 UN",
    "-20": "1-11/16-12 UN",
    "-24": "2-12 UN",
  },
};

// Adapter pipe ends are NPTF, as their product names state, though the interface field stores `NPT`.
const interfaceNames: Record<string, string> = {
  JIC: "JIC 37°",
  NPT: "NPTF",
  ORB: "ORB",
  ORFS: "ORFS",
};

function interfaceCode(value: string | null) {
  const code = value?.trim().toUpperCase() ?? "";
  return code === "NPTF" ? "NPT" : code;
}

export function connectorThread(
  connectorInterface: string | null,
  dash: DashSize | null,
) {
  return dash
    ? (connectorThreads[interfaceCode(connectorInterface)]?.[dash] ?? null)
    : null;
}

/** `JIC 37°`, `NPTF`: the customer-facing name of an adapter end's interface code. */
export function connectorInterfaceName(connectorInterface: string | null) {
  const code = interfaceCode(connectorInterface);
  return interfaceNames[code] ?? (connectorInterface?.trim() || null);
}
