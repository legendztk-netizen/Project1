import { evaluateAssemblyClockingApplicability } from "./assembly-clocking";
import type {
  AssemblyDraftValidationResult,
  DraftValidationIssue,
} from "./assembly-draft-validation";
import type { HoseConfigurationDraft } from "./hose-configuration-draft";

export type AssemblyReviewOutcome =
  "ready" | "technical_review" | "manual_quote" | "blocked";

export type AssemblyReviewRequirement =
  | "end_a"
  | "end_b"
  | "measurement_method"
  | "finished_length"
  | "clocking"
  | "installed_protection";

export interface AssemblyReviewInput {
  draft: HoseConfigurationDraft;
  quantityInput: string;
  validation: AssemblyDraftValidationResult;
}

export interface AssemblyReviewResult {
  canAddConfiguredLine: boolean;
  missingRequirements: AssemblyReviewRequirement[];
  outcome: AssemblyReviewOutcome;
  quantity: number | null;
  quantityError: string | null;
}

function parseQuantity(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null;
}

function missingRequirements(draft: HoseConfigurationDraft) {
  const missing: AssemblyReviewRequirement[] = [];
  if (!draft.endA) missing.push("end_a");
  if (!draft.endB) missing.push("end_b");
  if (!draft.measurementSelection) missing.push("measurement_method");
  if (!draft.finishedLength) missing.push("finished_length");
  if (
    evaluateAssemblyClockingApplicability(draft).status === "required" &&
    !draft.clocking
  ) {
    missing.push("clocking");
  }
  if (!draft.installedProtection) missing.push("installed_protection");
  return missing;
}

function requiresManualQuote(issue: DraftValidationIssue) {
  return issue.kind === "manual_path";
}

function requiresTechnicalReview(issue: DraftValidationIssue) {
  return issue.kind === "technical_review";
}

export function evaluateAssemblyReview(
  input: AssemblyReviewInput,
): AssemblyReviewResult {
  const quantity = parseQuantity(input.quantityInput);
  const missing = missingRequirements(input.draft);
  const blocked =
    input.validation.blocking || missing.length > 0 || quantity === null;

  if (blocked) {
    return {
      canAddConfiguredLine: false,
      missingRequirements: missing,
      outcome: "blocked",
      quantity,
      quantityError:
        quantity === null
          ? "Enter a positive whole number for quantity."
          : null,
    };
  }

  const outcome: AssemblyReviewOutcome = input.validation.issues.some(
    requiresManualQuote,
  )
    ? "manual_quote"
    : input.validation.issues.some(requiresTechnicalReview)
      ? "technical_review"
      : "ready";

  return {
    canAddConfiguredLine: outcome === "ready" || outcome === "technical_review",
    missingRequirements: [],
    outcome,
    quantity,
    quantityError: null,
  };
}
