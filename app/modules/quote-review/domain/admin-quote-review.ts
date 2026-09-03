export type AdminQuoteReviewState = "awaiting_review";
export type AdminTechnicalReviewState =
  "not_flagged" | "not_recorded" | "required";

export interface AdminQuoteReviewSource {
  id: string;
  referenceNumber: string;
  snapshot: unknown;
  submittedAt: string;
}

export interface AdminQuoteReviewSummary extends AdminQuoteReviewSource {
  customerDisplayName: string | null;
  customerEmail: string | null;
  destinationSummary: string | null;
  lineCount: number | null;
  merchandiseReferenceAmount: number | null;
  purchasingContextKind: "individual" | "organization" | null;
  purchasingContextLabel: string | null;
  reviewState: AdminQuoteReviewState;
  technicalReview: {
    reasons: string[];
    state: AdminTechnicalReviewState;
  };
}

export interface AdminQuoteReviewFilters {
  reviewState: "all" | AdminQuoteReviewState;
  sort: "newest" | "technical_first";
  technicalReview: "all" | AdminTechnicalReviewState;
}

type JsonObject = Record<string, unknown>;

export function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function jsonArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function jsonString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function jsonNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function jsonPath(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    const object = jsonObject(current);
    if (!object) return undefined;
    current = object[segment];
  }
  return current;
}

function technicalReview(snapshot: unknown) {
  const lines = jsonArray(jsonPath(snapshot, "lines"));
  if (!lines) {
    return {
      reasons: [] as string[],
      state: "not_recorded" as const,
    };
  }

  const reasons: string[] = [];
  let hasExplicitClearResult = false;
  let hasUnrecordedResult = false;

  for (const lineValue of lines) {
    const line = jsonObject(lineValue);
    if (!line) {
      hasUnrecordedResult = true;
      continue;
    }
    if (line.lineKind === "standard" || line.lineKind === "length_based_hose") {
      hasExplicitClearResult = true;
      continue;
    }
    if (line.lineKind !== "configured_assembly") {
      hasUnrecordedResult = true;
      continue;
    }

    const review = jsonObject(
      jsonPath(line, "configuredAssembly", "snapshot", "review"),
    );
    const outcome = jsonString(review?.outcome);
    const issues = jsonArray(review?.issues);
    if (!review || !outcome || !issues) {
      hasUnrecordedResult = true;
      continue;
    }

    const reviewRequired =
      outcome === "technical_review" || outcome === "manual_quote";
    if (reviewRequired && issues.length === 0) {
      reasons.push(`配置总成审核结果：${outcome}`);
    }
    for (const issueValue of issues) {
      const issue = jsonObject(issueValue);
      const kind = jsonString(issue?.kind);
      if (kind !== "technical_review" && kind !== "manual_path") continue;
      reasons.push(
        jsonString(issue?.message) ??
          jsonString(issue?.code) ??
          "配置总成需要技术审核。",
      );
    }
    if (!reviewRequired && reasons.length === 0) hasExplicitClearResult = true;
  }

  if (reasons.length > 0) {
    return { reasons: [...new Set(reasons)], state: "required" as const };
  }
  if (hasUnrecordedResult || lines.length === 0) {
    return { reasons: [], state: "not_recorded" as const };
  }
  return {
    reasons: [],
    state: hasExplicitClearResult
      ? ("not_flagged" as const)
      : ("not_recorded" as const),
  };
}

function destinationSummary(snapshot: unknown) {
  const destination = jsonObject(jsonPath(snapshot, "destination"));
  if (!destination) return null;
  const parts = [
    destination.city,
    destination.stateProvince,
    destination.postalCode,
    destination.countryCode,
  ].flatMap((value) => {
    const text = jsonString(value);
    return text ? [text] : [];
  });
  return parts.length > 0 ? parts.join(", ") : null;
}

export function projectAdminQuoteReview(
  source: AdminQuoteReviewSource,
): AdminQuoteReviewSummary {
  const actor = jsonObject(jsonPath(source.snapshot, "actor"));
  const context = jsonObject(jsonPath(source.snapshot, "purchasingContext"));
  const kind =
    context?.kind === "individual" || context?.kind === "organization"
      ? context.kind
      : null;
  const organizationName = jsonString(context?.legalName);
  const customerName = jsonString(actor?.fullName);
  const customerEmail = jsonString(actor?.email);
  const lines = jsonArray(jsonPath(source.snapshot, "lines"));

  return {
    ...source,
    customerDisplayName:
      kind === "organization"
        ? organizationName
        : (customerName ?? customerEmail),
    customerEmail,
    destinationSummary: destinationSummary(source.snapshot),
    lineCount: lines?.length ?? null,
    merchandiseReferenceAmount: jsonNumber(
      jsonPath(source.snapshot, "amounts", "merchandiseSubtotal"),
    ),
    purchasingContextKind: kind,
    purchasingContextLabel:
      kind === "organization"
        ? organizationName
        : kind === "individual"
          ? "个人采购"
          : null,
    reviewState: "awaiting_review",
    technicalReview: technicalReview(source.snapshot),
  };
}

export function parseAdminQuoteReviewFilters(
  url: URL,
): AdminQuoteReviewFilters {
  const reviewState = url.searchParams.get("review");
  const technicalReview = url.searchParams.get("technical");
  const sort = url.searchParams.get("sort");
  return {
    reviewState: reviewState === "awaiting_review" ? "awaiting_review" : "all",
    sort: sort === "technical_first" ? "technical_first" : "newest",
    technicalReview:
      technicalReview === "required" ||
      technicalReview === "not_flagged" ||
      technicalReview === "not_recorded"
        ? technicalReview
        : "all",
  };
}

const technicalPriority: Record<AdminTechnicalReviewState, number> = {
  required: 0,
  not_recorded: 1,
  not_flagged: 2,
};

export function filterAdminQuoteReviews(
  reviews: AdminQuoteReviewSummary[],
  filters: AdminQuoteReviewFilters,
) {
  return reviews
    .filter(
      (review) =>
        filters.reviewState === "all" ||
        review.reviewState === filters.reviewState,
    )
    .filter(
      (review) =>
        filters.technicalReview === "all" ||
        review.technicalReview.state === filters.technicalReview,
    )
    .toSorted((left, right) => {
      if (filters.sort === "technical_first") {
        const priority =
          technicalPriority[left.technicalReview.state] -
          technicalPriority[right.technicalReview.state];
        if (priority !== 0) return priority;
      }
      return (
        Date.parse(right.submittedAt) - Date.parse(left.submittedAt) ||
        right.id.localeCompare(left.id)
      );
    });
}

export function formatBeijingDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间快照无效";
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${valueFor("year")}-${valueFor("month")}-${valueFor("day")} ${valueFor("hour")}:${valueFor("minute")} 北京时间`;
}
