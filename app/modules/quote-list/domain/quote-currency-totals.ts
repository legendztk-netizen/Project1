import type { AnonymousQuoteLine } from "./anonymous-quote-list";

export interface QuoteCurrencyTotal {
  currency: string;
  merchandiseSubtotal: number | null;
  serviceFeeTotal: number;
}

const money = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Unknown assembly prices remain unknown; never combine original currencies. */
export function quoteCurrencyTotals(lines: AnonymousQuoteLine[]) {
  const groups = new Map<string, QuoteCurrencyTotal>();
  const group = (currency: string) => {
    let value = groups.get(currency);
    if (!value) {
      value = { currency, merchandiseSubtotal: 0, serviceFeeTotal: 0 };
      groups.set(currency, value);
    }
    return value;
  };
  for (const line of lines) {
    const current = line.refresh?.current;
    const currencies =
      current?.manualPricing && line.lineKind === "configured_assembly"
        ? [
            ...new Set(
              (
                line.refresh?.currentConfiguration ??
                line.configuredAssembly.snapshot
              ).productBasis?.flatMap((product) =>
                product.offer ? [product.offer.currency] : [],
              ) ?? [],
            ),
          ]
        : [current?.currency ?? line.currency];
    for (const currency of currencies) {
      const target = group(currency);
      const amount = current?.manualPricing
        ? null
        : (current?.discountedMerchandiseAmount ?? null);
      target.merchandiseSubtotal =
        amount === null || target.merchandiseSubtotal === null
          ? null
          : money(target.merchandiseSubtotal + amount);
    }
    if (current?.serviceFeeAmount) {
      const target = group("USD");
      target.serviceFeeTotal = money(
        target.serviceFeeTotal + current.serviceFeeAmount,
      );
    }
  }
  const values = [...groups.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );
  const manualReview =
    values.length !== 1 ||
    values[0]?.currency !== "USD" ||
    values.some((value) => value.merchandiseSubtotal === null);
  return { groups: values, manualReview };
}

export function formatQuoteAmounts(amounts: {
  currency: string | null;
  merchandiseSubtotal: number | null;
  groups?: QuoteCurrencyTotal[];
}) {
  const groups = amounts.groups ?? [
    {
      currency: amounts.currency ?? "USD",
      merchandiseSubtotal: amounts.merchandiseSubtotal,
    },
  ];
  return groups
    .map(
      (group) =>
        `${group.currency} ${group.merchandiseSubtotal === null ? "manual pricing" : group.merchandiseSubtotal.toFixed(2)}`,
    )
    .join(" · ");
}
