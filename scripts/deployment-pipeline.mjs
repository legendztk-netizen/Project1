import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"preview" | "production"} DeploymentEnvironment */
/** @typedef {"validation" | "live"} DeploymentMode */
/** @typedef {{ commands: Array<[string, string[]]>; name: string }} DeploymentStage */
/**
 * @typedef {object} DeploymentPipelineOptions
 * @property {DeploymentEnvironment} environment
 * @property {DeploymentMode} mode
 * @property {string | undefined} [liveDeploymentConfirmation]
 * @property {(stage: DeploymentStage) => void | Promise<void>} [runStage]
 */

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const supportedEnvironments = ["preview", "production"];
const supportedModes = ["validation", "live"];

export const deploymentStageNames = [
  "configuration",
  "migrations",
  "deployment",
  "health",
];

/**
 * @param {DeploymentEnvironment} environment
 * @param {DeploymentMode} mode
 * @returns {DeploymentStage[]}
 */
function stageDefinitions(environment, mode) {
  const environmentSuffix =
    environment === "production" ? "production" : "preview";
  const validation = mode === "validation";
  return [
    {
      commands: [
        [
          process.execPath,
          [
            "scripts/environment-config.mjs",
            validation ? "validate" : "require-deployable",
            environment,
          ],
        ],
      ],
      name: "configuration",
    },
    {
      commands: validation
        ? [
            [
              process.execPath,
              ["scripts/d1-migrations.mjs", "validate", environment],
            ],
          ]
        : [["pnpm", [`migrate:${environmentSuffix}`]]],
      name: "migrations",
    },
    {
      commands: [
        ["pnpm", [`build:${environmentSuffix}`]],
        [
          "pnpm",
          [
            "exec",
            "wrangler",
            "deploy",
            "--env",
            environment,
            ...(validation ? ["--dry-run"] : []),
          ],
        ],
      ],
      name: "deployment",
    },
    {
      commands: validation
        ? [["pnpm", ["test:smoke"]]]
        : [
            [
              process.execPath,
              ["scripts/health-smoke.mjs", "check", environment],
            ],
          ],
      name: "health",
    },
  ];
}

/** @param {DeploymentStage} stage */
function runStageCommands(stage) {
  const childEnvironment = { ...process.env };
  delete childEnvironment.CLOUDFLARE_ENV;
  process.stdout.write(`[deployment] stage=${stage.name} status=started\n`);
  for (const [command, args] of stage.commands) {
    execFileSync(command, args, {
      cwd: projectRoot,
      env: childEnvironment,
      stdio: "inherit",
    });
  }
  process.stdout.write(`[deployment] stage=${stage.name} status=completed\n`);
}

/** @param {DeploymentPipelineOptions} options */
export async function runDeploymentPipeline({
  environment,
  mode,
  liveDeploymentConfirmation = process.env.ALLOW_CLOUDFLARE_DEPLOYMENT,
  runStage = runStageCommands,
}) {
  if (!supportedEnvironments.includes(environment)) {
    throw new Error(`Unsupported deployment environment: ${environment}`);
  }
  if (!supportedModes.includes(mode)) {
    throw new Error(`Unsupported deployment mode: ${mode}`);
  }
  if (mode === "live" && liveDeploymentConfirmation !== "confirmed") {
    throw new Error(
      "Live deployment requires ALLOW_CLOUDFLARE_DEPLOYMENT=confirmed",
    );
  }

  for (const stage of stageDefinitions(environment, mode)) {
    await runStage(stage);
  }
}

const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const [, , mode, environment] = process.argv;
  try {
    await runDeploymentPipeline({
      environment: /** @type {DeploymentEnvironment} */ (environment),
      mode: /** @type {DeploymentMode} */ (mode),
    });
    process.stdout.write(
      `[deployment] environment=${environment} mode=${mode} status=completed\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[deployment] status=blocked reason=${message}\n`);
    process.exitCode = 1;
  }
}
