#!/usr/bin/env node

// Generic repository secret-material gate.
//
// Scans git tracked files and untracked, non-ignored text files for common
// credential material. Matched values are never echoed: only
// "file:line:rule" is reported. Symbolic links are never followed.

import { lstatSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_TEXT_FILE_BYTES = 8 * 1024 * 1024;
const BINARY_EXTENSIONS = new Set([
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);
const FORBIDDEN_ENV_BASENAMES =
  /(^|\/)\.env(?:\.(?!example(?:$|\.)|sample(?:$|\.))[^/]*)?$/i;
const RULES = [
  {
    id: "private_key",
    pattern: /-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----/g,
  },
  { id: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  {
    id: "github_fine_grained_token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g,
  },
  {
    id: "github_legacy_token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  },
  {
    id: "anthropic_api_key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    id: "openai_api_key",
    pattern: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
  },
  {
    id: "stripe_live_secret",
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g,
  },
  {
    id: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  {
    id: "npm_auth_token",
    pattern: /(?:^|\n)\s*(?:\/\/[^=\n]+\/:)?_authToken\s*=\s*[^\s${][^\n]*/g,
  },
  {
    id: "credentialed_url",
    pattern:
      /\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?#]|$)/g,
  },
];

function fail(message) {
  console.error("FAIL_SECRET_MATERIAL_GATE");
  console.error(`- ${message}`);
  process.exit(1);
}

function displayPath(file) {
  return file.replace(
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u{${character.codePointAt(0).toString(16)}}`,
  );
}

const listed = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
);
if (listed.status !== 0 || !listed.stdout) {
  fail("unable to enumerate repository files");
}

const files = listed.stdout
  .toString("utf8")
  .split("\0")
  .filter(Boolean)
  .sort();
const findings = [];
let textFilesScanned = 0;
let binaryFilesSkipped = 0;
let symbolicLinksSkipped = 0;

for (const file of files) {
  if (FORBIDDEN_ENV_BASENAMES.test(file)) {
    findings.push({ file, line: 1, rule: "tracked_or_unignored_env_file" });
    continue;
  }
  if (BINARY_EXTENSIONS.has(extname(file).toLowerCase())) {
    binaryFilesSkipped += 1;
    continue;
  }
  let stat;
  try {
    stat = lstatSync(file);
  } catch {
    // A staged deletion can still be returned by git ls-files.
    continue;
  }
  if (stat.isSymbolicLink()) {
    symbolicLinksSkipped += 1;
    continue;
  }
  if (!stat.isFile()) continue;
  if (stat.size > MAX_TEXT_FILE_BYTES) {
    findings.push({ file, line: 1, rule: "unscanned_oversized_text_file" });
    continue;
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) {
    binaryFilesSkipped += 1;
    continue;
  }
  const text = bytes.toString("utf8");
  textFilesScanned += 1;
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const before = text.slice(0, match.index ?? 0);
      findings.push({
        file,
        line: before.split("\n").length,
        rule: rule.id,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("FAIL_SECRET_MATERIAL_GATE");
  for (const finding of findings) {
    // Never echo matched material.
    console.error(
      `- ${displayPath(finding.file)}:${finding.line}: ${finding.rule}`,
    );
  }
  process.exit(1);
}

console.log("GREEN_SECRET_MATERIAL_GATE");
console.log(`text_files_scanned=${textFilesScanned}`);
console.log(`binary_files_skipped=${binaryFilesSkipped}`);
console.log(`symbolic_links_skipped=${symbolicLinksSkipped}`);
