import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../bin/secret-gate.mjs",
);
const temporaryDirectories = [];

after(() => {
  for (const dir of temporaryDirectories) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "secret-gate-"));
  temporaryDirectories.push(dir);
  execFileSync("git", ["init", "-q", "-b", "main"], {
    cwd: dir,
    stdio: "ignore",
  });
  return dir;
}

function runGate(dir) {
  return spawnSync(process.execPath, [BIN], { cwd: dir, encoding: "utf8" });
}

test("safe repository passes", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, "example.txt"), "hello world\n");
  const result = runGate(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /GREEN_SECRET_MATERIAL_GATE/);
});

test("provider API key is detected", () => {
  const dir = makeRepo();
  const fakeKey = "sk-proj-" + "a".repeat(40);
  writeFileSync(path.join(dir, "config.txt"), `OPENAI_API_KEY=${fakeKey}\n`);
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /api_key/);
});

test("provider API key with ant prefix is detected", () => {
  const dir = makeRepo();
  const fakeKey = "sk-ant-" + "a".repeat(32);
  writeFileSync(path.join(dir, "config.txt"), `PROVIDER_API_KEY=${fakeKey}\n`);
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /anthropic_api_key/);
  assert.doesNotMatch(result.stderr, /openai_api_key/);
});

test("github personal access token is detected", () => {
  const dir = makeRepo();
  const fakeToken = "ghp_" + "b".repeat(36);
  writeFileSync(path.join(dir, "config.txt"), `TOKEN=${fakeToken}\n`);
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /github_legacy_token/);
});

test("unignored env file is rejected", () => {
  const dir = makeRepo();
  writeFileSync(path.join(dir, ".env.local"), "LOCAL_VALUE=placeholder\n");
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tracked_or_unignored_env_file/);
});

test("matched secret values are never echoed", () => {
  const dir = makeRepo();
  const fakeKey = "sk-proj-" + "a".repeat(40);
  writeFileSync(path.join(dir, "config.txt"), `OPENAI_API_KEY=${fakeKey}\n`);
  const result = runGate(dir);
  assert.equal(result.status, 1);
  assert.equal(result.stderr.includes(fakeKey), false);
  assert.equal(result.stdout.includes(fakeKey), false);
});

test("symbolic links are skipped without reading outside the repository", () => {
  const dir = makeRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "secret-gate-outside-"));
  temporaryDirectories.push(outside);
  const fakeKey = "sk-proj-" + "z".repeat(40);
  const outsideFile = path.join(outside, "outside.txt");
  writeFileSync(outsideFile, `${fakeKey}\n`);
  symlinkSync(outsideFile, path.join(dir, "linked.txt"));

  const result = runGate(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /symbolic_links_skipped=1/);
  assert.equal(result.stdout.includes(fakeKey), false);
  assert.equal(result.stderr.includes(fakeKey), false);
});
