import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bin/license-gate.mjs",
);
const temporaryDirectories = [];

after(() => {
  for (const dir of temporaryDirectories) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "license-gate-"));
  temporaryDirectories.push(dir);
  return dir;
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
  assertInputFailure(result, "package-lock.json contains malformed JSON");
});

function assertInputFailure(result, message) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "", "input failures must not emit a partial summary");
  assert.equal(result.stderr, `FAIL_DEPENDENCY_LICENSE_POLICY\n- ${message}\n`);
}

for (const value of [null, [], true, 42, "not-a-lockfile"]) {
  test(`non-object JSON root ${JSON.stringify(value)} is a classified input failure`, () => {
    const dir = makeDir();
    writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify(value));
    const result = runGate(dir);
    assertInputFailure(result, "package-lock.json must contain a JSON object");
    assert.equal(runGate(dir).stderr, result.stderr);
  });
}

test("directory lockfile paths are classified read failures", () => {
  const dir = makeDir();
  mkdirSync(path.join(dir, "package-lock.json"));
  for (const args of [[], ["package-lock.json"]]) {
    assertInputFailure(
      runGate(dir, args),
      "unable to read lockfile: package-lock.json",
    );
  }
});

test("an invalid later lockfile prevents a partial summary", () => {
  const dir = makeDir();
  writeFileSync(path.join(dir, "a-valid.json"), lockfile({
    "node_modules/dep": { version: "1.0.0", license: "MIT" },
  }));
  writeFileSync(path.join(dir, "z-invalid.json"), "null");
  for (const args of [
    ["a-valid.json", "z-invalid.json"],
    ["z-invalid.json", "a-valid.json"],
  ]) {
    assertInputFailure(runGate(dir, args), "z-invalid.json must contain a JSON object");
  }
});

for (const version of [2, 3]) {
  test(`valid v${version} summary and hash remain deterministic`, () => {
    const dir = makeDir();
    const contents = lockfile({
      "node_modules/dep": { version: "1.0.0", license: "MIT" },
    }, version);
    writeFileSync(path.join(dir, "package-lock.json"), contents);
    const sha256 = createHash("sha256").update(contents).digest("hex");
    const result = runGate(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      classification: "GREEN_DEPENDENCY_LICENSE_POLICY",
      lockSha256: sha256,
      lockfiles: [{ path: "package-lock.json", sha256 }],
      packageCount: 1,
      missingLicenseCount: 0,
      deniedLicenseCount: 0,
      reviewLicenseCount: 0,
      licenseDistribution: { MIT: 1 },
      reviewPackages: [],
      missingPackages: [],
      deniedPackages: [],
    });
    assert.equal(runGate(dir).stdout, result.stdout);
  });
}
