/** A hose as US buyers name it: short name `R2`, standard `SAE 100R2AT`, as printed on the hose. */
export interface CompatibleHose {
  shortName: string;
  standard: string | null;
}

/** Customer names of a hose series from its primary standard; the series code when the standard is not recognised. */
export function hoseStandardName(
  series: string,
  primaryStandard: string | null | undefined,
): CompatibleHose {
  const text = primaryStandard?.trim().replace(/\s+/g, " ").toUpperCase() ?? "";
  const sae = /^SAE ?100 ?R(\d+)([A-Z]*)$/.exec(text);
  if (sae) {
    return {
      shortName: `R${sae[1]}`,
      standard: `SAE 100R${sae[1]}${sae[2]}`,
    };
  }
  const en = /^EN ?(\d+) (\d*[A-Z]+)$/.exec(text);
  if (en) return { shortName: en[2]!, standard: `EN ${en[1]} ${en[2]}` };
  return { shortName: series, standard: primaryStandard?.trim() || null };
}

/** `SAE 100R2AT Hydraulic Hose (R2)`, as Hydraulax names its hoses. */
export function hoseFamilyName(
  series: string,
  primaryStandard: string | null | undefined,
) {
  const name = hoseStandardName(series, primaryStandard);
  return name.standard && name.shortName !== series
    ? `${name.standard} Hydraulic Hose (${name.shortName})`
    : `${series} Hydraulic Hose`;
}

const saeNumber = (shortName: string) =>
  /^R(\d+)$/.exec(shortName)?.[1] ?? null;

/** SAE hoses by number (R1, R2, R4, R16), then EN and other hoses by name. */
export function compareHoseShortNames(left: string, right: string) {
  const [l, r] = [saeNumber(left), saeNumber(right)];
  if (l !== null && r !== null) return Number(l) - Number(r);
  if (l !== null) return -1;
  if (r !== null) return 1;
  return left.localeCompare(right);
}

/** Distinct hoses by short name, in display order. */
export function sortedCompatibleHoses(hoses: Iterable<CompatibleHose>) {
  const byName = new Map<string, CompatibleHose>();
  for (const hose of hoses) {
    if (!byName.has(hose.shortName)) byName.set(hose.shortName, hose);
  }
  return [...byName.values()].toSorted((left, right) =>
    compareHoseShortNames(left.shortName, right.shortName),
  );
}

export function formatCompatibleHoses(hoses: CompatibleHose[]) {
  return hoses
    .map((hose) =>
      hose.standard ? `${hose.shortName} (${hose.standard})` : hose.shortName,
    )
    .join(", ");
}
