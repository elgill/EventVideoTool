#!/usr/bin/env node
// Stages the ffmpeg/ffprobe binaries that npm already downloaded (as the
// content of the @ffmpeg-installer/* and @ffprobe-installer/* packages) into
// src-tauri/binaries with the file names Tauri's sidecar bundling expects
// (<name>-<rust-target-triple>[.exe]). Runs automatically via `npm install`
// (postinstall) and again before every dev/build, so nobody ever hand-places
// an ffmpeg binary.
//
// Falls back to a manual --triple flag for cross-preparing a binary that
// isn't the current machine's platform (used by CI's per-OS matrix, where
// each runner naturally gets its own platform's optionalDependency anyway,
// but this keeps the script usable standalone too).

import { createRequire } from "node:module";
import { copyFileSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const binariesDir = join(repoRoot, "src-tauri", "binaries");

function hostTriple() {
  const arg = process.argv.find((a) => a.startsWith("--triple="));
  if (arg) return arg.split("=")[1];
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/host:\s*(\S+)/);
  if (!match) throw new Error("Could not determine rustc host target triple");
  return match[1];
}

function stage(pkgName, destBaseName, triple, isWindows) {
  const pkg = require(pkgName);
  const srcPath = pkg.path;
  if (!srcPath || !existsSync(srcPath)) {
    throw new Error(
      `${pkgName} did not resolve to a binary on disk (got: ${srcPath}). ` +
        `Is the optional platform dependency installed for this OS/arch?`
    );
  }
  const ext = isWindows ? ".exe" : "";
  const destPath = join(binariesDir, `${destBaseName}-${triple}${ext}`);
  mkdirSync(binariesDir, { recursive: true });
  copyFileSync(srcPath, destPath);
  chmodSync(destPath, 0o755);
  console.log(`staged ${pkgName} -> ${destPath}`);
}

const triple = hostTriple();
const isWindows = triple.includes("windows");

stage("@ffmpeg-installer/ffmpeg", "ffmpeg", triple, isWindows);
stage("@ffprobe-installer/ffprobe", "ffprobe", triple, isWindows);

console.log(`ffmpeg/ffprobe sidecars staged for target ${triple}`);
