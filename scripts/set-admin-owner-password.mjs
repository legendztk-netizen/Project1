import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ownerCredentialSql,
  ownerPasswordHash,
  validatedOwnerPassword,
} from "./admin-owner-credential.mjs";

const projectRoot = new URL("../", import.meta.url);
const wranglerBin = fileURLToPath(
  new URL("../node_modules/.bin/wrangler", import.meta.url),
);
const contract = JSON.parse(
  readFileSync(
    new URL("config/environment-contract.json", projectRoot),
    "utf8",
  ),
);

function readHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          "No terminal for a hidden prompt. Set ADMIN_OWNER_PASSWORD instead.",
        ),
      );
      return;
    }
    process.stdout.write(question);
    let value = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (
          character === "\r" ||
          character === "\n" ||
          character === "\u0004"
        ) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u007f") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

function d1(database, environment, command) {
  const output = execFileSync(
    wranglerBin,
    [
      "d1",
      "execute",
      database,
      "--env",
      environment,
      "--remote",
      "--json",
      "--command",
      command,
    ],
    {
      cwd: fileURLToPath(projectRoot),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  return JSON.parse(output.slice(output.indexOf("[")))[0];
}

const environment = process.argv[2];
if (!["preview", "production"].includes(environment ?? "")) {
  console.error(
    "Usage: node scripts/set-admin-owner-password.mjs <preview|production>",
  );
  process.exit(1);
}

try {
  const database = contract.environments[environment].resourceNames.database;
  let password = process.env.ADMIN_OWNER_PASSWORD;
  if (!password) {
    password = await readHidden(
      `New password for the ${environment} Owner (username "admin"): `,
    );
    const repeat = await readHidden("Repeat the password: ");
    if (password !== repeat) throw new Error("The passwords do not match.");
  }
  validatedOwnerPassword(password);
  const hash = await ownerPasswordHash(password);
  const owners = d1(
    database,
    environment,
    "SELECT COUNT(*) AS n FROM admin_identities WHERE account_type = 'owner' AND deleted_at IS NULL",
  );
  const ownerExists = Number(owners.results[0]?.n) > 0;
  const result = d1(
    database,
    environment,
    ownerCredentialSql(hash, new Date().toISOString(), ownerExists),
  );
  if (result.success !== true)
    throw new Error("The database rejected the change.");
  console.log(
    `${ownerExists ? "Updated" : "Created"} the ${environment} Owner: username "admin". Existing Owner sessions were signed out.`,
  );
} catch (error) {
  console.error(
    `[set-admin-owner-password] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
