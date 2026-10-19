import { fitDescription, listText, presentTypes } from "./catalog-seo";

const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** `six`, or digits past twelve. */
export function countWord(count: number) {
  return numberWords[count] ?? String(count);
}

const capitalized = (word: string) => word[0]!.toUpperCase() + word.slice(1);

export function homeTitle(appName: string) {
  return `Hydraulic Hose Assembly — Made to Length | ${appName}`;
}

/**
 * Counts come from the published hose catalog. They count hose sizes, not assemblies: some
 * sizes have no compatible fitting, so the sentence speaks of hose (user decision 2026-10-19).
 * Without counts the text stays true, only shorter.
 */
export function homeDescription(
  hoseCatalog: { seriesCount: number; sizeCount: number } | null,
) {
  return fitDescription([
    {
      options: ["Custom hydraulic hose assemblies built to your exact length."],
      required: true,
    },
    {
      options: [
        " Pick a hose series, both ends and the length, then request a quote.",
      ],
      required: true,
    },
    hoseCatalog && hoseCatalog.seriesCount > 0 && hoseCatalog.sizeCount > 0
      ? [
          ` ${capitalized(countWord(hoseCatalog.seriesCount))} hose series in ${hoseCatalog.sizeCount} sizes.`,
        ]
      : null,
  ]);
}

export function buildAHoseTitle(appName: string) {
  return `Custom Hydraulic Hose — Configure & Quote | ${appName}`;
}

/** The connection types named on Build a Hose, kept only while hose ends of that type exist. */
export function buildAHoseEndTypes(interfaceGroups: string[]) {
  return presentTypes(
    [
      ["JIC", /JIC/],
      ["NPT", /NPT/],
      ["ORFS", /ORFS/],
      ["BSP", /BSP/],
    ],
    interfaceGroups,
  );
}

export function buildAHoseDescription(seriesCount: number, endTypes: string[]) {
  const series =
    seriesCount > 0
      ? `pick from ${countWord(seriesCount)} hose series`
      : "pick a hose series";
  return fitDescription([
    {
      options: [
        `Configure your custom hydraulic hose: ${series}, choose both ends, set the finished length and request a quote.`,
      ],
      required: true,
    },
    endTypes.length
      ? [` ${listText(endTypes)} ends.`, ` ${listText(endTypes)}.`]
      : null,
  ]);
}
