import { readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);
const contract = JSON.parse(
  readFileSync(
    new URL("config/environment-contract.json", projectRoot),
    "utf8",
  ),
);

function healthUrl(environment) {
  const definition = contract.environments[environment];
  if (!definition)
    throw new Error(`Unknown health-check environment: ${environment}`);
  return new URL("/health", definition.vars.PUBLIC_STOREFRONT_ORIGIN);
}

export async function checkHealth(environment) {
  const url = healthUrl(environment);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload?.status !== "ok") {
    throw new Error(`Health check failed with HTTP ${response.status}`);
  }
  process.stdout.write(
    `[health-smoke] environment=${environment} mode=live status=ok\n`,
  );
}

const [, , command, environment] = process.argv;
if (command === "check") await checkHealth(environment);
else throw new Error("Usage: health-smoke.mjs check <preview|production>");
