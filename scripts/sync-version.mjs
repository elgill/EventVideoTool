#!/usr/bin/env node
// Copies the version from package.json (the single source of truth, bumped by
// `npm run release`) into src-tauri/Cargo.toml and Cargo.lock. tauri.conf.json
// doesn't need updating: its "version" points at ../package.json.
//
// Runs as release-it's after:bump hook; safe to run by hand any time.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const cargoToml = join(repoRoot, "src-tauri", "Cargo.toml");

const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

// Only touch the `version` line inside [package], not dependency versions.
const toml = readFileSync(cargoToml, "utf8");
const updated = toml.replace(
  /(\[package\][^[]*?\nversion\s*=\s*")[^"]*(")/,
  `$1${version}$2`,
);
if (updated === toml && !toml.includes(`version = "${version}"`)) {
  throw new Error("Could not find [package] version in Cargo.toml");
}
writeFileSync(cargoToml, updated);

// Refresh Cargo.lock's entry for this crate without touching dependencies.
execFileSync(
  "cargo",
  ["update", "--workspace", "--offline", "--manifest-path", cargoToml],
  { stdio: "inherit" },
);

console.log(`Synced Cargo version to ${version}`);
