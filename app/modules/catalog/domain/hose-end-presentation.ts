import { fittingLineOfSeriesCode } from "./fitting-line";
import { slug } from "./public-catalog";

/** The series fields a Hose End is named, grouped and pictured by. */
export interface HoseEndShape {
  angle: string | null;
  connectionStandard: string | null;
  fittingSeries: string | null;
  gender: string | null;
  interfaceFamily: string | null;
  swivelForm: string | null;
}

export interface HoseEndPresentation {
  /** One catalog family per series shape and Fitting Line. */
  familyKey: string;
  /** Customer-facing interface, such as `SAE Code 62` for a Code 62 flange. */
  interface: string;
  lengthClass: string | null;
  /** Reviewed-image key; same-shape ends of every line share it. */
  mediaKey: string;
  /** Shared by every size of the series, such as `JIC 37° Female Swivel 90° Long Bite-the-Wire Hose End`. */
  name: string;
}

// One-piece series codes are `<Fitting Line>_<code>_<gender>_<swivel>` (ADR 0056);
// earlier codes start with the competitor family, such as `FJX90L Hydraulax ...`.
function shapeCode(fittingSeries: string | null) {
  const series = fittingSeries?.trim().toUpperCase() ?? "";
  return fittingLineOfSeriesCode(series)
    ? { code: series.split("_")[1] ?? "", onePiece: true }
    : { code: series.split(/\s+/, 1)[0] ?? "", onePiece: false };
}

function lengthClassOf(code: string, onePiece: boolean) {
  if (onePiece) {
    if (code.endsWith("XL")) return "Extra Long";
    if (code.endsWith("90M")) return "Medium";
    return code.endsWith("L") ? "Long" : null;
  }
  if (code === "FJX90L" || code === "FFX90L") return "Long";
  if (code === "FJX90M" || code === "FFX90M") return "Medium";
  return null;
}

function customerInterface(code: string, shape: HoseEndShape) {
  if (
    code === "FPX" ||
    code === "NPSM" ||
    shape.connectionStandard?.toUpperCase().includes("NPSM")
  ) {
    return "NPSM";
  }
  if (code.startsWith("C61")) return "SAE Code 61";
  if (code.startsWith("C62")) return "SAE Code 62";
  if (code === "BSPFF") return "BSPP Flat Face";
  return shape.interfaceFamily ?? "Hose End";
}

/** The thread a customer can match, or null for flange, weld, tube and grease ends stored as `N/A (…)`. */
export function hoseEndThread(thread: string | null | undefined) {
  const text = thread?.trim();
  return text && !/^N\/A\b/i.test(text) ? text : null;
}

/** Same-shape braided, bite-the-wire, six-wire and stainless ends read and group apart, as at Hydraulax. */
export function hoseEndPresentation(shape: HoseEndShape): HoseEndPresentation {
  const { code, onePiece } = shapeCode(shape.fittingSeries);
  const line = fittingLineOfSeriesCode(shape.fittingSeries ?? "");
  const lengthClass = lengthClassOf(code, onePiece);
  const exactInterface = customerInterface(code, shape);
  const shapeParts = [
    exactInterface,
    shape.gender === "N/A" ? null : shape.gender,
    shape.swivelForm,
    shape.angle,
    lengthClass,
  ].filter(Boolean);
  const material = line === "SS" || line === "SSW" ? "Stainless" : null;
  // Customers do not know W or JJ, so the name says how the end is crimped.
  const crimpStyle =
    line === "W" || line === "SSW"
      ? "Bite-the-Wire"
      : line === "JJ"
        ? "Skive"
        : null;
  return {
    familyKey: slug(
      [material, ...shapeParts, crimpStyle].filter(Boolean).join("-"),
    ),
    interface: exactInterface,
    lengthClass,
    mediaKey: shapeParts.join("-"),
    name: [material, ...shapeParts, crimpStyle, "Hose End"]
      .filter(Boolean)
      .join(" "),
  };
}
