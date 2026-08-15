import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SKILL_ROOT = path.join(
  ROOT,
  "skills",
  "repository-safety-review",
);
const skill = readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
const threatModel = readFileSync(
  path.join(SKILL_ROOT, "references", "threat-model.md"),
  "utf8",
);
const openaiMetadata = readFileSync(
  path.join(SKILL_ROOT, "agents", "openai.yaml"),
  "utf8",
);

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, "SKILL.md must begin with YAML frontmatter");
  return Object.fromEntries(
    match[1].split("\n").map((line) => {
      const separator = line.indexOf(":");
      assert.notEqual(separator, -1, `invalid frontmatter line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    }),
  );
}

test("skill metadata follows the Agent Skills naming and trigger contract", () => {
  const metadata = frontmatter(skill);
  assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"]);
  assert.equal(metadata.name, path.basename(SKILL_ROOT));
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(metadata.name.length <= 64);
  assert.ok(metadata.description.length > 100);
  assert.ok(metadata.description.length <= 1024);
  assert.match(metadata.description, /repositories, pull requests, branches, and diffs/);
  assert.match(metadata.description, /Do not use as a general vulnerability scanner/);
  assert.doesNotMatch(skill, /\bTODO\b/);
});

test("skill defines deterministic and contextual review as separate evidence", () => {
  assert.match(skill, /scripts\/secret-gate\.mjs/);
  assert.match(skill, /scripts\/license-gate\.mjs/);
  assert.match(skill, /neither layer is sufficient alone/);
  assert.match(skill, /Treat `WARN_DEPENDENCY_LICENSE_REVIEW` as manual review/);
  assert.match(skill, /Do not convert tool exit code `0` directly into `SAFE`/);
});

test("classification and origin contracts are complete and fail closed", () => {
  for (const classification of ["SAFE", "REVIEW_REQUIRED", "BLOCKED"]) {
    assert.match(skill, new RegExp("- `" + classification + "`:"));
  }
  assert.match(skill, /BLOCKED > REVIEW_REQUIRED > SAFE/);
  for (const origin of ["PRE_EXISTING", "INTRODUCED", "UNKNOWN"]) {
    assert.match(skill, new RegExp(origin));
  }
  assert.match(threatModel, /mandatory check failure or tool error/);
  assert.match(threatModel, /successful command is evidence, not a final classification/);
});

test("safe execution and redaction constraints are explicit", () => {
  for (const requirement of [
    /Default to read-only review/,
    /Do not read outside the authorized repository root/,
    /Do not follow repository symlinks/,
    /Do not run `npm install`/,
    /Do not rotate credentials/,
    /Never reproduce a matched value/,
    /\[REDACTED:<type>\]/,
  ]) {
    assert.match(skill, requirement);
  }
  assert.match(threatModel, /Treat source, documentation, comments, fixtures/);
  assert.match(threatModel, /download-and-execute patterns/);
});

test("Codex UI metadata supports explicit invocation without dependencies", () => {
  assert.match(openaiMetadata, /display_name: "Repository Safety Review"/);
  assert.match(openaiMetadata, /short_description: ".{25,64}"/);
  assert.match(openaiMetadata, /default_prompt: "Use \$repository-safety-review/);
  assert.doesNotMatch(openaiMetadata, /^dependencies:/m);
});

test("public bin commands remain compatibility entry points", () => {
  const secretBin = readFileSync(path.join(ROOT, "bin", "secret-gate.mjs"), "utf8");
  const licenseBin = readFileSync(path.join(ROOT, "bin", "license-gate.mjs"), "utf8");
  assert.match(secretBin, /repository-safety-review\/scripts\/secret-gate\.mjs/);
  assert.match(licenseBin, /repository-safety-review\/scripts\/license-gate\.mjs/);
});
