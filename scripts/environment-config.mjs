import { readFileSync } from "node:fs";

const projectRoot = new URL("../", import.meta.url);
const contract = readJson("config/environment-contract.json");
const wrangler = readJson("wrangler.jsonc");
const environmentNames = ["local", "preview", "production"];

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, projectRoot), "utf8"));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameMembers(actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  return (
    actualSorted.length === expectedSorted.length &&
    actualSorted.every((value, index) => value === expectedSorted[index])
  );
}

function sameStringRecord(actual, expected) {
  return sameMembers(
    Object.entries(actual).map(([key, value]) => `${key}=${value}`),
    Object.entries(expected).map(([key, value]) => `${key}=${value}`),
  );
}

function resolvedWranglerEnvironment(environment) {
  if (environment === "local") return wrangler;
  const selected = wrangler.env?.[environment];
  assert(selected, `Wrangler environment ${environment} is missing`);
  return selected;
}

function assertUniqueEnvironmentValues() {
  const definitions = Object.values(contract.environments);
  for (const [label, select] of [
    ["Worker", (item) => item.workerName],
    ["D1", (item) => item.resourceNames.database],
    ["R2", (item) => item.resourceNames.privateFiles],
    ["Queue", (item) => item.resourceNames.asyncJobs],
    ["Storefront origin", (item) => item.vars.PUBLIC_STOREFRONT_ORIGIN],
    ["Admin origin", (item) => item.vars.ADMIN_ORIGIN],
  ]) {
    assert(
      new Set(definitions.map(select)).size === definitions.length,
      `${label} values must be unique across environments`,
    );
  }

  const deployedDatabaseIds = ["preview", "production"]
    .map((environment) => resolvedWranglerEnvironment(environment))
    .flatMap((definition) => definition.d1_databases ?? [])
    .filter((database) => !isPlaceholder(database.database_id))
    .map((database) => database.database_id);
  assert(
    new Set(deployedDatabaseIds).size === deployedDatabaseIds.length,
    "D1 database_id values must be unique across deployed environments",
  );
}

function validateEnvironment(environment) {
  assert(environmentNames.includes(environment), `Unknown environment: ${environment}`);
  assertUniqueEnvironmentValues();

  const expected = contract.environments[environment];
  const actual = resolvedWranglerEnvironment(environment);
  assert(actual.name === expected.workerName, `${environment} Worker name does not match contract`);
  assert(
    sameStringRecord(actual.vars, expected.vars),
    `${environment} vars do not match environment-contract.json`,
  );

  const database = actual.d1_databases?.find(
    (item) => item.binding === contract.bindingNames.database,
  );
  assert(database, `${environment} is missing D1 binding ${contract.bindingNames.database}`);
  assert(
    database.database_name === expected.resourceNames.database,
    `${environment} D1 resource name does not match contract`,
  );

  const privateFiles = actual.r2_buckets?.find(
    (item) => item.binding === contract.bindingNames.privateFiles,
  );
  assert(
    privateFiles,
    `${environment} is missing R2 binding ${contract.bindingNames.privateFiles}`,
  );
  assert(
    privateFiles.bucket_name === expected.resourceNames.privateFiles,
    `${environment} R2 resource name does not match contract`,
  );

  const asyncJobs = actual.queues?.producers?.find(
    (item) => item.binding === contract.bindingNames.asyncJobs,
  );
  assert(asyncJobs, `${environment} is missing Queue binding ${contract.bindingNames.asyncJobs}`);
  assert(
    asyncJobs.queue === expected.resourceNames.asyncJobs,
    `${environment} Queue resource name does not match contract`,
  );

  if (environment === "local") {
    for (const [label, resource] of [
      ["D1", database],
      ["R2", privateFiles],
      ["Queue", asyncJobs],
    ]) {
      assert(resource.remote !== true, `local ${label} binding must not target a remote resource`);
    }
  }

  const requiredSecrets = actual.secrets?.required ?? [];
  assert(
    sameMembers(requiredSecrets, expected.requiredSecrets),
    `${environment} required secret names do not match contract`,
  );

  const knownSecretNames = Object.values(contract.environments).flatMap(
    (definition) => definition.requiredSecrets,
  );
  assert(
    requiredSecrets.every((name) => knownSecretNames.includes(name)),
    `${environment} declares an unknown secret name`,
  );

  return { actual, expected };
}

function isPlaceholder(value) {
  return (
    !value ||
    contract.placeholderPolicy.tokens.some((token) => value.includes(token)) ||
    contract.placeholderPolicy.suffixes.some((suffix) => value.endsWith(suffix))
  );
}

function requireDeployable(environment) {
  assert(environment !== "local", "The local environment cannot be deployed");
  const { actual, expected } = validateEnvironment(environment);
  const errors = [];
  const database = actual.d1_databases.find(
    (item) => item.binding === contract.bindingNames.database,
  );

  if (isPlaceholder(database.database_id)) {
    errors.push(`D1 database_id for ${environment} is still a placeholder`);
  }

  for (const key of contract.placeholderPolicy.deployedVariables) {
    if (isPlaceholder(actual.vars[key])) errors.push(`${key} is still a placeholder`);
  }

  for (const name of [
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    ...expected.requiredSecrets,
  ]) {
    if (!process.env[name]) errors.push(`Missing deployment secret ${name}`);
  }

  if (errors.length > 0) {
    throw new Error(`Deployment blocked for ${environment}:\n- ${errors.join("\n- ")}`);
  }
}

const [, , command, environment] = process.argv;

try {
  if (command === "validate") {
    validateEnvironment(environment);
    process.stdout.write(`environment=${environment} contract=valid\n`);
  } else if (command === "require-deployable") {
    requireDeployable(environment);
    process.stdout.write(`environment=${environment} deployment=ready\n`);
  } else {
    throw new Error("Usage: environment-config.mjs <validate|require-deployable> <environment>");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[environment-config] ${message}\n`);
  process.exitCode = 1;
}

export { requireDeployable, validateEnvironment };
