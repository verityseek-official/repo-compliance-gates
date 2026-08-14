#!/usr/bin/env node

// Generic npm lockfile license gate.
//
// Inspects lockfile dependency license metadata, identifies missing or
// denied licenses, and flags licenses that require manual review. Exits
// non-zero when missing or denied licenses are found, so it can be used
// as a CI gate.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const DENIED_LICENSE_TOKENS = new Set([
  "AGPL-1.0",
  "AGPL-1.0-only",
  "AGPL-1.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "BUSL-1.1",
  "Commons-Clause",
  "GPL-1.0",
  "GPL-1.0-only",
  "GPL-1.0-or-later",
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "SSPL-1.0",
]);

const REVIEW_LICENSE_TOKENS = new Set([
  "CC-BY-4.0",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-2.0",
  "Unlicense",
]);

const SUPPORTED_LOCKFILE_VERSIONS = new Set([2, 3]);

function licenseTokens(expression) {
  return expression.match(/[A-Za-z0-9][A-Za-z0-9.-]*/g) ?? [];
}

function fail(message) {
  console.error("FAIL_DEPENDENCY_LICENSE_POLICY");
  console.error(`- ${message}`);
  process.exit(1);
}

function defaultLockfiles(root) {
  const files = [];
  const rootLock = join(root, "package-lock.json");
  if (existsSync(rootLock)) files.push(rootLock);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name === "node_modules" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const candidate = join(root, entry.name, "package-lock.json");
    if (existsSync(candidate)) files.push(candidate);
  }
  return files.sort();
}

const root = process.cwd();
const positional = process.argv.slice(2);
const lockPaths =
  positional.length > 0
    ? positional.map((filePath) => resolve(filePath))
    : defaultLockfiles(root);

if (lockPaths.length === 0) {
  fail("no package-lock.json found");
}
for (const filePath of lockPaths) {
  if (!existsSync(filePath)) fail(`lockfile not found: ${filePath}`);
}

const distribution = new Map();
const missing = [];
const denied = [];
const review = [];
const lockfiles = [];
let packageCount = 0;
let rootLockSha256 = "";

for (const lockPath of lockPaths.sort()) {
  const lockBytes = readFileSync(lockPath);
  let lock;
  try {
    lock = JSON.parse(lockBytes.toString("utf8"));
  } catch {
    fail(`${relative(root, lockPath)} contains malformed JSON`);
  }
  const lockName = relative(root, lockPath);
  if (!SUPPORTED_LOCKFILE_VERSIONS.has(lock.lockfileVersion)) {
    fail(`${lockName} must use a supported lockfile version (2 or 3)`);
  }
  if (!lock.packages || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    fail(`${lockName} must contain a valid packages metadata object`);
  }
  for (const [packagePath, metadata] of Object.entries(lock.packages)) {
    if (packagePath && (!metadata || typeof metadata !== "object" || Array.isArray(metadata))) {
      fail(`${lockName} has invalid metadata for ${packagePath}`);
    }
  }
  const sha256 = createHash("sha256").update(lockBytes).digest("hex");
  if (lockPath === join(root, "package-lock.json")) rootLockSha256 = sha256;
  lockfiles.push({ path: lockName, sha256 });

  for (const [packagePath, metadata] of Object.entries(lock.packages)) {
    if (!packagePath) continue;
    packageCount += 1;
    const identity = `${lockName}:${packagePath}`;
    const license =
      metadata && typeof metadata === "object" && typeof metadata.license === "string"
        ? metadata.license.trim()
        : "";
    if (!license) {
      missing.push(identity);
      continue;
    }
    distribution.set(license, (distribution.get(license) ?? 0) + 1);
    const tokens = licenseTokens(license);
    if (tokens.some((token) => DENIED_LICENSE_TOKENS.has(token))) {
      denied.push({ packagePath: identity, license });
    } else if (tokens.some((token) => REVIEW_LICENSE_TOKENS.has(token))) {
      review.push({ packagePath: identity, license });
    }
  }
}

const summary = {
  classification:
    missing.length > 0 || denied.length > 0
      ? "FAIL_DEPENDENCY_LICENSE_POLICY"
      : review.length > 0
        ? "WARN_DEPENDENCY_LICENSE_REVIEW"
        : "GREEN_DEPENDENCY_LICENSE_POLICY",
  lockSha256: rootLockSha256,
  lockfiles,
  packageCount,
  missingLicenseCount: missing.length,
  deniedLicenseCount: denied.length,
  reviewLicenseCount: review.length,
  licenseDistribution: Object.fromEntries(
    [...distribution.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
  reviewPackages: review,
  missingPackages: missing,
  deniedPackages: denied,
};

console.log(JSON.stringify(summary, null, 2));
if (missing.length > 0 || denied.length > 0) process.exit(1);
