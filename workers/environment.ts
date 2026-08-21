import environmentContract from "../config/environment-contract.json";

export type AppEnvironment = "local" | "preview" | "production";

export type ApplicationBindings = CloudflareBindings;

export interface ValidatedRuntimeEnvironment {
  environment: AppEnvironment;
}

const requiredBindings = [
  [environmentContract.bindingNames.database, "D1 database"],
  [environmentContract.bindingNames.privateFiles, "private R2 bucket"],
  [environmentContract.bindingNames.asyncJobs, "asynchronous job Queue"],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlaceholder(value: string) {
  return (
    environmentContract.placeholderPolicy.tokens.some((token) => value.includes(token)) ||
    environmentContract.placeholderPolicy.suffixes.some((suffix) => value.endsWith(suffix))
  );
}

function validateOrigin(
  key: "PUBLIC_STOREFRONT_ORIGIN" | "ADMIN_ORIGIN",
  value: string,
  environment: AppEnvironment,
  errors: string[],
) {
  try {
    const origin = new URL(value);
    if (origin.origin !== value) errors.push(`${key} must be an origin without a path`);
    if (environment === "local" && origin.protocol !== "http:") {
      errors.push(`${key} must use http in local development`);
    }
    if (environment !== "local" && origin.protocol !== "https:") {
      errors.push(`${key} must use https outside local development`);
    }
  } catch {
    errors.push(`${key} must be a valid absolute origin`);
  }
}

export function validateRuntimeEnvironment(
  input: unknown,
): ValidatedRuntimeEnvironment {
  if (!isRecord(input)) throw new Error("Invalid runtime configuration: bindings are missing");

  const environment = input.APP_ENV;
  if (environment !== "local" && environment !== "preview" && environment !== "production") {
    throw new Error(
      `Invalid runtime configuration: APP_ENV must be local, preview, or production; received ${String(environment)}`,
    );
  }

  const expectedEnvironment = environmentContract.environments[environment];
  const errors: string[] = [];
  for (const [binding, label] of requiredBindings) {
    if (!(binding in input) || input[binding] == null) {
      errors.push(`Missing binding ${binding} (${label})`);
    }
  }

  for (const variable of Object.keys(expectedEnvironment.vars)) {
    if (typeof input[variable] !== "string" || input[variable].trim() === "") {
      errors.push(`Missing variable ${variable}`);
    }
  }

  if (errors.length === 0) {
    const storefrontOrigin = String(input.PUBLIC_STOREFRONT_ORIGIN);
    const adminOrigin = String(input.ADMIN_ORIGIN);
    validateOrigin("PUBLIC_STOREFRONT_ORIGIN", storefrontOrigin, environment, errors);
    validateOrigin("ADMIN_ORIGIN", adminOrigin, environment, errors);

    if (storefrontOrigin === adminOrigin) {
      errors.push("PUBLIC_STOREFRONT_ORIGIN and ADMIN_ORIGIN must be distinct");
    }

    if (environment === "local") {
      if (input.ADMIN_AUTH_MODE !== "local-stub") {
        errors.push("ADMIN_AUTH_MODE must be local-stub in local development");
      }
      if (input.EMAIL_DELIVERY_MODE !== "stub") {
        errors.push("EMAIL_DELIVERY_MODE must be stub in local development");
      }
    } else {
      for (const variable of environmentContract.placeholderPolicy.deployedVariables) {
        if (isPlaceholder(String(input[variable]))) {
          errors.push(`${variable} is still a placeholder for ${environment}`);
        }
      }
      if (input.ADMIN_AUTH_MODE !== "cloudflare-access") {
        errors.push(`ADMIN_AUTH_MODE must be cloudflare-access for ${environment}`);
      }
      if (input.EMAIL_DELIVERY_MODE !== "resend") {
        errors.push(`EMAIL_DELIVERY_MODE must be resend for ${environment}`);
      }
      for (const secret of expectedEnvironment.requiredSecrets) {
        if (typeof input[secret] !== "string" || input[secret].trim() === "") {
          errors.push(`Missing secret ${secret}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid runtime configuration for "${environment}":\n- ${errors.join("\n- ")}`,
    );
  }

  return { environment };
}
