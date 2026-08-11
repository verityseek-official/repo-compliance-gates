import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bin/license-gate.mjs",
);

function makeDir() {
  return mkdtempSync(path.join(tmpdir(), "license-gate-"));
}

function lockfile(extraPackages) {
  return JSON.stringify(
    {
      lockfileVersion: 3,
      packages: {
        "": {
          name: "fixture-root",
          version: "1.0.0",
          license: "MIT",
        },
        ...extraPackages,
      },
    },
    null,
    2,
  );
}

function runGate(dir, args = []) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("acceptable licenses pass", () => {
  const dir = makeDir();
  writeFileSync(
    path.join(dir, "package-lock.json"),
    lockfile({
      "node_modules/dep": { version: "1.0.0", license: "MIT" },
    }),
  );
  const result = runGate(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GREEN_DEPENDENCY_LICENSE_POLICY/);
});

test("denied license fails", () => {
  const dir = makeDir();
  writeFileSync(
    path.join(dir, "package-lock.json"),
    lockfile({
      "node_modules/dep": { version: "1.0.0", license: "GPL-3.0" },
    }),
  );
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"deniedLicenseCount": 1/);
});

test("missing license metadata fails", () => {
  const dir = makeDir();
  writeFileSync(
    path.join(dir, "package-lock.json"),
    lockfile({
      "node_modules/dep": { version: "1.0.0" },
    }),
  );
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"missingLicenseCount": 1/);
});

test("review-required license warns but passes", () => {
  const dir = makeDir();
  writeFileSync(
    path.join(dir, "package-lock.json"),
    lockfile({
      "node_modules/dep": { version: "1.0.0", license: "LGPL-3.0" },
    }),
  );
  const result = runGate(dir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WARN_DEPENDENCY_LICENSE_REVIEW/);
});

test("explicit lockfile path is accepted", () => {
  const dir = makeDir();
  const lockPath = path.join(dir, "custom-lock.json");
  writeFileSync(lockPath, lockfile({}));
  const result = runGate(makeDir(), [lockPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GREEN_DEPENDENCY_LICENSE_POLICY/);
});

test("no lockfile found fails", () => {
  const dir = makeDir();
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no package-lock\.json found/);
});
