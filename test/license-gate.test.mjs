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

function lockfile(extraPackages, version = 3) {
  return JSON.stringify(
    {
      lockfileVersion: version,
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

function runLockfile(extraPackages, version = 3) {
  const dir = makeDir();
  writeFileSync(
    path.join(dir, "package-lock.json"),
    lockfile(extraPackages, version),
  );
  return runGate(dir);
}

function runGate(dir, args = []) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("acceptable licenses pass", () => {
  const result = runLockfile({
    "node_modules/dep": { version: "1.0.0", license: "MIT" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GREEN_DEPENDENCY_LICENSE_POLICY/);
});

test("denied license fails", () => {
  const result = runLockfile({
    "node_modules/dep": { version: "1.0.0", license: "GPL-3.0" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"deniedLicenseCount": 1/);
});

test("missing license metadata fails", () => {
  const result = runLockfile({
    "node_modules/dep": { version: "1.0.0" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"missingLicenseCount": 1/);
});

test("review-required license warns but passes", () => {
  const result = runLockfile({
    "node_modules/dep": { version: "1.0.0", license: "LGPL-3.0" },
  });
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

test("valid lockfile v2 passes", () => {
  const result = runLockfile({
    "node_modules/dep": { version: "1.0.0", license: "MIT" },
  }, 2);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GREEN_DEPENDENCY_LICENSE_POLICY/);
});

test("lockfile v2 preserves denied, missing, and review policy behavior", () => {
  assert.equal(
    runLockfile({ "node_modules/dep": { license: "GPL-3.0" } }, 2).status,
    1,
  );
  assert.equal(runLockfile({ "node_modules/dep": {} }, 2).status, 1);
  const review = runLockfile(
    { "node_modules/dep": { license: "LGPL-3.0" } },
    2,
  );
  assert.equal(review.status, 0, review.stderr);
  assert.match(review.stdout, /WARN_DEPENDENCY_LICENSE_REVIEW/);
});

test("unsupported lockfile versions fail", () => {
  const result = runLockfile({}, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /supported lockfile version/);
});

test("missing or invalid packages metadata fails", () => {
  const missing = makeDir();
  writeFileSync(
    path.join(missing, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 2 }),
  );
  const missingResult = runGate(missing);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /valid packages metadata object/);

  const invalid = makeDir();
  writeFileSync(
    path.join(invalid, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/dep": [] } }),
  );
  const invalidResult = runGate(invalid);
  assert.equal(invalidResult.status, 1);
  assert.match(invalidResult.stderr, /invalid metadata/);
});

test("malformed lockfiles fail", () => {
  const dir = makeDir();
  writeFileSync(path.join(dir, "package-lock.json"), "{not-json");
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /malformed JSON/);
});
