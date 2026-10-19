import {
  launchCatalogFamilies,
  type CatalogFamilyId,
} from "../../catalog/domain/catalog-family";
import {
  hoseStandardName,
  sortedCompatibleHoses,
  type CompatibleHose,
} from "../../catalog/domain/hose-name";
import {
  quickCouplerRoleName,
  type PublicCatalogFamily,
  type PublicCatalogItem,
  type PublicVariantSelection,
} from "../../catalog/domain/public-catalog";

const productionStorefrontOrigin = "https://customhoseco.com";
export const descriptionLength = { min: 150, max: 160 } as const;
const titleLength = 60;

export interface PageSeo {
  canonical: string;
  description: string;
  title: string;
}

/** `<title>`, description and canonical link for a route's `meta` export. */
export function seoMeta(seo: PageSeo) {
  return [
    { title: seo.title },
    { name: "description", content: seo.description },
    { tagName: "link", rel: "canonical", href: seo.canonical },
  ];
}

/** An absolute storefront URL without a query, on the same origin and fallback as robots.txt. */
export function canonicalUrl(origin: string | undefined, path: string) {
  const base = (origin?.trim() || productionStorefrontOrigin).replace(
    /\/+$/,
    "",
  );
  return `${base}${path}`;
}

/** One part of a description, its wordings from fullest to shortest. Optional parts may be left out. */
interface Part {
  options: string[];
  required?: boolean;
}

type PartInput = Part | string[] | null;

/**
 * Joins parts in order so the text lands in 150–160 characters. Including an earlier part wins
 * over including a later one, then fuller wordings win. Nothing is padded: when no combination
 * fits, the closest one is used.
 */
export function fitDescription(inputs: PartInput[]) {
  const parts = inputs
    .filter((input): input is Part | string[] => input !== null)
    .map((input) => (Array.isArray(input) ? { options: input } : input))
    .filter((part) => part.options.length > 0);
  const { min, max } = descriptionLength;
  let best: { choice: number[]; text: string } | null = null;
  const distance = (length: number) =>
    length < min ? min - length : Math.max(length - max, 0);
  // Per part: the wording index, or -1 when the part is left out.
  const better = (left: number[], right: number[]) => {
    for (let index = 0; index < left.length; index += 1) {
      const [l, r] = [left[index]!, right[index]!];
      if (l >= 0 !== r >= 0) return l >= 0;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index]! < right[index]!;
    }
    return false;
  };
  const visit = (index: number, text: string, choice: number[]) => {
    if (text.length > max) return;
    if (index === parts.length) {
      const gap = distance(text.length);
      const bestGap = best ? distance(best.text.length) : Infinity;
      if (gap < bestGap || (gap === bestGap && better(choice, best!.choice))) {
        best = { choice: [...choice], text };
      }
      return;
    }
    const part = parts[index]!;
    part.options.forEach((option, optionIndex) =>
      visit(index + 1, text + option, [...choice, optionIndex]),
    );
    if (!part.required) visit(index + 1, text, [...choice, -1]);
  };
  visit(0, "", []);
  return (
    (best as { text: string } | null)?.text ??
    parts
      .filter((part) => part.required)
      .map((part) => part.options.at(-1))
      .join("")
  );
}

const numberFormat = new Intl.NumberFormat("en-US");

/** A real value: not blank and not a stored placeholder such as `N/A` or `N/A (weld end)`. */
function present(value: string | null | undefined): value is string {
  return (
    Boolean(value?.trim()) &&
    !/^(n\/?a|none|-)(\s*\(.*\))?$/i.test(value!.trim())
  );
}

function distinct<T>(values: Iterable<T>) {
  return [...new Set(values)];
}

/** `a`, `a and b`, `a, b and c`. */
function listText(values: string[], conjunction = "and") {
  return values.length < 2
    ? (values[0] ?? "")
    : `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

/** Lower-cases a leading ordinary word (`Ball lock` → `ball lock`) but keeps acronyms like `ORB`. */
function midSentence(value: string) {
  return /^[A-Z][a-z]/.test(value)
    ? value[0]!.toLowerCase() + value.slice(1)
    : value;
}

function dashNumber(value: string | null | undefined) {
  const match = /^-(\d+)$/.exec(value?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

/** `-4 to -64`, or the one size. */
function dashRange(values: Array<string | null | undefined>) {
  const sizes = distinct(
    values.map(dashNumber).filter((size) => size !== null),
  ).toSorted((left, right) => left - right);
  if (!sizes.length) return null;
  return sizes.length === 1
    ? `-${sizes[0]}`
    : `-${sizes[0]} to -${sizes.at(-1)}`;
}

/** The smallest and largest of a size-ordered list, such as threads by dash; two values read `a or b`. */
function orderedRange(
  pairs: Array<[number | null, string | null | undefined]>,
) {
  const values = distinct(
    pairs
      .filter((pair): pair is [number | null, string] => present(pair[1]))
      .toSorted(
        ([left], [right]) =>
          (left ?? Number.MAX_SAFE_INTEGER) -
          (right ?? Number.MAX_SAFE_INTEGER),
      )
      .map(([, value]) => value.trim()),
  );
  if (values.length < 3) return values.length ? listText(values, "or") : null;
  return `${values[0]} to ${values.at(-1)}`;
}

function specValues(items: PublicCatalogItem[], label: string) {
  return distinct(
    items.flatMap((item) =>
      item.specs
        .filter((spec) => spec.label === label && present(spec.value))
        .map((spec) => spec.value.trim()),
    ),
  );
}

function selections<K extends PublicVariantSelection["kind"]>(
  items: PublicCatalogItem[],
  kind: K,
) {
  return items.flatMap((item) =>
    item.variantSelection?.kind === kind
      ? [
          {
            item,
            selection: item.variantSelection as Extract<
              PublicVariantSelection,
              { kind: K }
            >,
          },
        ]
      : [],
  );
}

const quoteOnline = [". Request a quote online.", ". Quote online."];

function quoteParts(items: PublicCatalogItem[]): Part {
  // Only hoses are sold by length; every hose size carries length ordering.
  const cutToLength =
    items.length > 0 && items.every((item) => item.offer?.lengthOrdering);
  return {
    options: cutToLength
      ? [
          ". Cut to length; request a quote online.",
          ". Cut to length, quote online.",
        ]
      : quoteOnline,
    required: true,
  };
}

function hoseFacts(items: PublicCatalogItem[]) {
  const hoses = selections(items, "hose").map(({ selection }) => selection);
  const psi = hoses.flatMap((hose) =>
    hose.performance.workingPsi === null ? [] : [hose.performance.workingPsi],
  );
  const minC = hoses.flatMap((hose) =>
    hose.performance.temperatureMinC === null
      ? []
      : [hose.performance.temperatureMinC],
  );
  const maxC = hoses.flatMap((hose) =>
    hose.performance.temperatureMaxC === null
      ? []
      : [hose.performance.temperatureMaxC],
  );
  return {
    hoses,
    maxPsi: psi.length ? numberFormat.format(Math.max(...psi)) : null,
    range: dashRange(hoses.map((hose) => hose.dash)),
    temperature:
      minC.length && maxC.length
        ? `${Math.min(...minC)}°C to ${Math.max(...maxC)}°C`
        : null,
  };
}

function hoseName(family: PublicCatalogFamily) {
  const selection = family.representative.variantSelection;
  return selection?.kind === "hose"
    ? hoseStandardName(selection.hoseSeries, selection.primaryStandard)
    : null;
}

function compatibleHoses(items: PublicCatalogItem[]) {
  return sortedCompatibleHoses(
    selections(items, "hose_end").flatMap(
      ({ selection }) => selection.compatibleHoses ?? [],
    ),
  );
}

/** `SAE 100R1AT, R2AT, R4 and 4SH`: the first standard in full, the rest by their short forms. */
function compactStandards(hoses: CompatibleHose[], conjunction: string) {
  return listText(
    hoses.map((hose, index) => {
      if (index === 0) return hose.standard ?? hose.shortName;
      return hose.standard?.startsWith("SAE 100")
        ? hose.standard.slice("SAE 100".length)
        : hose.shortName;
    }),
    conjunction,
  );
}

/** Whether `text` already says `phrase`, ignoring case and spacing (`SAE 100 R1AT` = `SAE 100R1AT`). */
function mentions(text: string, phrase: string) {
  const squash = (value: string) => value.toLowerCase().replace(/\s+/g, "");
  return squash(text).includes(squash(phrase));
}

function hoseFamilyDescription(family: PublicCatalogFamily) {
  const { maxPsi, range, temperature, hoses } = hoseFacts(family.variants);
  const standard = hoseName(family)?.standard;
  const equivalent = hoses.map((hose) => hose.equivalentStandard).find(present);
  const nominalIds = orderedRange(
    selections(family.variants, "hose").map(({ item, selection }) => [
      dashNumber(selection.dash),
      specValues([item], "Nominal ID")[0],
    ]),
  );
  return fitDescription([
    { options: [family.familyName], required: true },
    range
      ? [
          ` in ${family.variants.length} sizes from ${range}`,
          ` in sizes ${range}`,
        ]
      : null,
    maxPsi
      ? [`, working pressure up to ${maxPsi} psi`, `, up to ${maxPsi} psi`]
      : null,
    temperature ? [`, temperature ${temperature}`, `, ${temperature}`] : null,
    // Hose names already carry their primary standard.
    standard && !mentions(family.familyName, standard)
      ? [`, ${standard}`]
      : null,
    equivalent ? [`, equivalent to ${equivalent}`] : null,
    nominalIds ? [`, ${nominalIds} ID`] : null,
    present(hoses[0]?.reinforcement) ? [`, ${hoses[0]!.reinforcement}`] : null,
    quoteParts(family.variants),
  ]);
}

function hoseEndFamilyDescription(family: PublicCatalogFamily) {
  const ends = selections(family.variants, "hose_end").map(
    ({ selection }) => selection,
  );
  const hoses = compatibleHoses(family.variants);
  const standards = specValues(family.variants, "Connection standard");
  // `Grease fitting thread` adds nothing to `Grease fitting`, nor `Weld` to `Socket weld`.
  const seals = specValues(family.variants, "Sealing form").filter(
    (seal) =>
      !standards.some(
        (standard) => mentions(seal, standard) || mentions(standard, seal),
      ),
  );
  const sizes = dashRange(ends.map((end) => end.connectionDash));
  const tails = dashRange(ends.map((end) => end.hoseTailDash));
  const threads = orderedRange(
    ends.map((end) => [dashNumber(end.connectionDash), end.thread]),
  );
  const count = family.variants.length;
  return fitDescription([
    // The family name without its `for R1, R2 … Hose` list, which follows as its own part.
    { options: [family.representative.familyName], required: true },
    hoses.length
      ? [
          ` for ${compactStandards(hoses, "and")} hose`,
          ` for ${listText(hoses.map((hose) => hose.shortName))} hose`,
        ]
      : null,
    standards.length ? [`: ${listText(standards)}`] : null,
    seals.length ? [`, ${midSentence(listText(seals, "or"))}`] : null,
    sizes?.includes(" to ")
      ? [`, ${count} sizes from ${sizes}`, `, sizes ${sizes}`]
      : sizes
        ? [`, ${sizes} connection`]
        : null,
    tails ? [`, hose tail ${tails}`] : null,
    threads ? [`, threads ${threads}`] : null,
    quoteParts(family.variants),
  ]);
}

function adapterEndFacts(family: PublicCatalogFamily, end: 0 | 1) {
  const adapters = selections(family.variants, "adapter").map(
    ({ selection }) => selection.ends[end],
  );
  return {
    name: distinct(
      adapters.map((item) => item.interfaceName).filter(present),
    )[0],
    sizes: dashRange(adapters.map((item) => item.dash)),
    threads: orderedRange(
      adapters.map((item) => [dashNumber(item.dash), item.thread]),
    ),
  };
}

function adapterFamilyDescription(family: PublicCatalogFamily) {
  const [first, second] = [
    adapterEndFacts(family, 0),
    adapterEndFacts(family, 1),
  ];
  const count = family.variants.length;
  return fitDescription([
    { options: [family.familyName], required: true },
    [` in ${count} size combinations`, ` in ${count} sizes`],
    first.name && second.name && first.sizes && second.sizes
      ? [`: ${first.name} ${first.sizes}, ${second.name} ${second.sizes}`]
      : null,
    first.name && first.threads
      ? [`, ${first.name} threads ${first.threads}`]
      : null,
    second.name && second.threads
      ? [`, ${second.name} threads ${second.threads}`]
      : null,
    quoteParts(family.variants),
  ]);
}

function couplerFacts(items: PublicCatalogItem[]) {
  const couplers = selections(items, "quick_coupler").map(
    ({ selection }) => selection,
  );
  return {
    bodies: orderedRange(
      couplers.map((item) => [dashNumber(item.bodyDash), item.bodySize]),
    ),
    ports: orderedRange(
      couplers.map((item) => [dashNumber(item.portDash), item.portThread]),
    ),
    portInterfaces: distinct(
      couplers.map((item) => item.portInterface).filter(present),
    ),
    roles: distinct(
      couplers
        .map((item) => quickCouplerRoleName(item.role))
        .filter(present)
        .map((role) => role.toLowerCase()),
    ),
  };
}

function couplerFamilyDescription(family: PublicCatalogFamily) {
  const { bodies, ports, roles } = couplerFacts(family.variants);
  const valving = specValues(family.variants, "Valving");
  const mechanism = specValues(family.variants, "Connection mechanism");
  return fitDescription([
    { options: [family.familyName], required: true },
    valving.length
      ? [`: ${midSentence(listText(valving, "or"))} valving`]
      : null,
    mechanism.length ? [`, ${midSentence(listText(mechanism, "or"))}`] : null,
    bodies ? [`, body sizes ${bodies}`] : null,
    ports ? [`, ports ${ports}`] : null,
    roles.length ? [`. Sold as ${listText(roles, "or")}`] : null,
    quoteParts(family.variants),
  ]);
}

const familyDescriptions: Partial<
  Record<CatalogFamilyId, (family: PublicCatalogFamily) => string>
> = {
  "hydraulic-hose": hoseFamilyDescription,
  "hose-ends": hoseEndFamilyDescription,
  adapters: adapterFamilyDescription,
  "quick-couplers": couplerFamilyDescription,
};

const categoryNoun: Record<CatalogFamilyId, string> = {
  "hydraulic-hose": "Hydraulic Hose",
  "hose-ends": "Hose End",
  ferrules: "Ferrule",
  adapters: "Adapter",
  "quick-couplers": "Quick Coupler",
};

/**
 * `{family name} — {category noun} | {app}`, the noun only when the name lacks it. Past 60
 * characters the noun goes, then a bracketed note such as `(R1)`; if that still does not fit,
 * the full title stays, since model names are never cut.
 */
export function catalogFamilyTitle(
  family: Pick<PublicCatalogFamily, "category" | "familyName">,
  appName: string,
) {
  const brand = ` | ${appName}`;
  const noun = categoryNoun[family.category];
  const name = family.familyName;
  const full = name.toLowerCase().includes(noun.toLowerCase())
    ? `${name}${brand}`
    : `${name} — ${noun}${brand}`;
  const candidates = [
    full,
    `${name}${brand}`,
    `${name.replace(/\s*\([^)]*\)/g, "")}${brand}`,
  ];
  return candidates.find((title) => title.length <= titleLength) ?? full;
}

export function catalogFamilySeo(
  family: PublicCatalogFamily,
  appName: string,
  origin: string | undefined,
): PageSeo {
  const describe = familyDescriptions[family.category];
  return {
    canonical: canonicalUrl(
      origin,
      `/catalog/${family.category}/${family.familyKey}`,
    ),
    description: describe
      ? describe(family)
      : fitDescription([
          { options: [family.familyName], required: true },
          quoteParts(family.variants),
        ]),
    title: catalogFamilyTitle(family, appName),
  };
}

/** `SAE 100R1AT, R2AT, R4, R16, R17 & 4SH`: the first standard in full, the rest by their short forms. */
function hoseSeriesList(families: PublicCatalogFamily[]) {
  return compactStandards(
    families.flatMap((family) => {
      const name = hoseName(family);
      return name ? [name] : [];
    }),
    "&",
  );
}

/** The listed connection names the data actually has, so a title never names a missing type. */
function presentTypes(
  candidates: Array<[label: string, pattern: RegExp]>,
  names: string[],
) {
  return candidates
    .filter(([, pattern]) => names.some((name) => pattern.test(name)))
    .map(([label]) => label);
}

function withTypes(lead: string, types: string[], appName: string) {
  return `${lead}${types.length ? ` — ${types.join(", ")}` : ""} | ${appName}`;
}

function interfaceGroupsByCount(families: PublicCatalogFamily[]) {
  const counts = new Map<string, number>();
  for (const family of families) {
    if (present(family.interfaceGroup)) {
      counts.set(
        family.interfaceGroup,
        (counts.get(family.interfaceGroup) ?? 0) + 1,
      );
    }
  }
  return [...counts]
    .toSorted(([a, left], [b, right]) => right - left || a.localeCompare(b))
    .map(([name]) => name);
}

function adapterPairs(families: PublicCatalogFamily[]) {
  return distinct(
    families.flatMap((family) => {
      const selection = family.representative.variantSelection;
      if (selection?.kind !== "adapter") return [];
      const [first, second] = selection.ends.map((end) => end.interfaceName);
      return present(first) && present(second) ? [`${first} to ${second}`] : [];
    }),
  );
}

function adapterEndNames(families: PublicCatalogFamily[]) {
  return families.flatMap((family) =>
    selections(family.variants, "adapter").flatMap(({ selection }) =>
      selection.ends.map((end) => end.interfaceName ?? ""),
    ),
  );
}

function categoryTitle(
  category: CatalogFamilyId,
  families: PublicCatalogFamily[],
  appName: string,
) {
  switch (category) {
    case "hydraulic-hose": {
      const series = hoseSeriesList(families);
      return `Hydraulic Hose${series ? ` — ${series}` : ""} | ${appName}`;
    }
    case "hose-ends":
      return withTypes(
        "Hose Ends & Hydraulic Fittings",
        presentTypes(
          [
            ["JIC", /JIC/],
            ["NPT", /NPT/],
            ["SAE", /^SAE/],
          ],
          families.map((family) => family.interfaceGroup ?? ""),
        ),
        appName,
      );
    case "adapters":
      return withTypes(
        "Hydraulic Adapters & Fittings",
        presentTypes(
          [
            ["JIC", /JIC/],
            ["NPT", /NPT/],
            ["ORFS", /ORFS/],
          ],
          adapterEndNames(families),
        ),
        appName,
      );
    case "quick-couplers":
      return `Hydraulic Quick Couplers & Disconnects | ${appName}`;
    default: {
      const label = launchCatalogFamilies.find(
        (family) => family.id === category,
      )?.label;
      return `${label ?? category} | ${appName}`;
    }
  }
}

function categoryDescription(
  category: CatalogFamilyId,
  families: PublicCatalogFamily[],
) {
  const items = families.flatMap((family) => family.variants);
  switch (category) {
    case "hydraulic-hose": {
      const { maxPsi, range, temperature } = hoseFacts(items);
      const names = families.flatMap((family) => {
        const name = hoseName(family);
        return name ? [name] : [];
      });
      return fitDescription([
        {
          options: [`${families.length} hydraulic hose series`],
          required: true,
        },
        names.length
          ? [
              ` (${names.map((name) => name.standard ?? name.shortName).join(", ")})`,
              ` (${names.map((name) => name.shortName).join(", ")})`,
            ]
          : null,
        range ? [` in dash sizes ${range}`, ` in sizes ${range}`] : null,
        maxPsi
          ? [`, working pressure up to ${maxPsi} psi`, `, up to ${maxPsi} psi`]
          : null,
        temperature ? [`, ${temperature}`] : null,
        quoteParts(items),
      ]);
    }
    case "hose-ends": {
      const types = interfaceGroupsByCount(families);
      const angles = specValues(items, "Angle").flatMap((angle) => {
        const degrees = /^(\d+)°/.exec(angle)?.[1];
        return degrees === undefined ? [] : [Number(degrees)];
      });
      const ends = selections(items, "hose_end").map(
        ({ selection }) => selection,
      );
      const sizes = dashRange(ends.map((end) => end.connectionDash));
      const hoses = compatibleHoses(items).map((hose) => hose.shortName);
      return fitDescription([
        {
          options: [`${families.length} hydraulic hose end families`],
          required: true,
        },
        // Every type there is, then fewer, but always the four most common.
        types.length
          ? Array.from(
              { length: Math.max(types.length - 3, 1) },
              (_, dropped) =>
                ` in ${listText(types.slice(0, types.length - dropped))} styles`,
            )
          : null,
        angles.includes(0) && Math.max(...angles) > 0
          ? [`, straight to ${Math.max(...angles)}°`]
          : null,
        hoses.length ? [`, for ${listText(hoses)} hose`] : null,
        sizes ? [`, connection sizes ${sizes}`] : null,
        quoteParts(items),
      ]);
    }
    case "adapters": {
      const pairs = adapterPairs(families);
      const shapes = specValues(items, "Shape");
      const forms = distinct(
        selections(items, "adapter").flatMap(({ selection }) =>
          selection.ends.map((end) => end.form ?? ""),
        ),
      );
      const sizes = dashRange(
        selections(items, "adapter").flatMap(({ selection }) =>
          selection.ends.map((end) => end.dash),
        ),
      );
      return fitDescription([
        {
          options: [
            pairs.length
              ? `Hydraulic adapters for ${listText(pairs)} connections`
              : "Hydraulic adapters",
          ],
          required: true,
        },
        shapes.length === 1 && forms.length === 1 && present(forms[0])
          ? [
              `: ${midSentence(shapes[0]!)} ${midSentence(forms[0])}-to-${midSentence(forms[0])}`,
            ]
          : null,
        sizes
          ? [`, ${items.length} sizes from ${sizes}`, `, sizes ${sizes}`]
          : null,
        quoteParts(items),
      ]);
    }
    case "quick-couplers": {
      const { bodies, portInterfaces, roles } = couplerFacts(items);
      const standards = families
        .map((family) => family.interfaceGroup)
        .filter(present);
      return fitDescription([
        {
          options: [
            standards.length
              ? `Hydraulic quick couplers and disconnects to ${listText(standards)}`
              : "Hydraulic quick couplers and disconnects",
          ],
          required: true,
        },
        roles.length ? [`, sold as ${listText(roles, "or")}`] : null,
        bodies ? [`, body sizes ${bodies}`] : null,
        portInterfaces.length ? [`, ${listText(portInterfaces)} ports`] : null,
        quoteParts(items),
      ]);
    }
    default:
      return (
        launchCatalogFamilies.find((family) => family.id === category)
          ?.description ?? ""
      );
  }
}

/** One title, description and canonical for every page of a category, whatever its query. */
export function catalogCategorySeo(
  category: CatalogFamilyId,
  families: PublicCatalogFamily[],
  appName: string,
  origin: string | undefined,
): PageSeo {
  return {
    canonical: canonicalUrl(origin, `/catalog/${category}`),
    description: categoryDescription(category, families),
    title: categoryTitle(category, families, appName),
  };
}
