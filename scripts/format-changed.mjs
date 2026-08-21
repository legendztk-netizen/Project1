import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const prettierBin = fileURLToPath(
  new URL("../node_modules/.bin/prettier", import.meta.url),
);
const supportedExtension = /\.(css|json|md|mjs|ts|tsx|yaml|yml)$/;

function gitLines(args) {
  const output = execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
  });
  return output.split("\n").filter(Boolean);
}

function changedFiles() {
  const base = process.env.FORMAT_BASE_SHA;
  const tracked = base
    ? gitLines(["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
    : gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]);
  if (base) return tracked;

  const untracked = gitLines([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ".github",
    "app",
    "config",
    "docs/operations/admin-access-and-deployment.md",
    "scripts",
    "test",
    "workers",
  ]);
  return [...new Set([...tracked, ...untracked])];
}

const mode = process.argv[2];
if (mode !== "check" && mode !== "write") {
  throw new Error("Usage: format-changed.mjs <check|write>");
}

const files = changedFiles().filter(
  (file) => file !== "pnpm-lock.yaml" && supportedExtension.test(file),
);
if (files.length === 0) {
  process.stdout.write("No changed files require formatting.\n");
} else {
  const result = spawnSync(
    prettierBin,
    [mode === "check" ? "--check" : "--write", ...files],
    {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  process.exitCode = result.status ?? 1;
}
