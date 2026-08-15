# repo-compliance-gates

Small, zero-runtime-dependency tools for safer repository maintenance:

- `secret-gate` detects likely credential material without printing matched values.
- `license-gate` reviews npm lockfile license metadata against a conservative policy.
- `repository-safety-review` is a Codex-first Agent Skill that combines both deterministic gates with contextual review of prompt injection, dangerous side effects, and supply-chain changes.

The Skill follows the [open Agent Skills specification](https://agentskills.io/specification) used by [Codex skills](https://developers.openai.com/codex/skills). It remains usable by other Agent-Skills-compatible coding agents.

## Requirements

- Node.js 18 or newer
- `git` on `PATH` for `secret-gate`
- no npm runtime dependencies

## Command-line gates

Clone the repository and run the tools from the root of the repository being reviewed, or use `npm link` to place the commands on `PATH`.

### secret-gate

```sh
node bin/secret-gate.mjs
```

It scans tracked and untracked, non-ignored working-tree text for common private keys, provider keys, tokens, npm auth values, credential-bearing URLs, and unignored `.env` files. Symbolic links are skipped rather than followed. Exit code `0` means no finding in the scanned surface; `1` means a finding or gate failure. Output contains only `file:line:rule`, never the matched value.

### license-gate

```sh
node bin/license-gate.mjs
node bin/license-gate.mjs package-lock.json path/to/package-lock.json
```

It reads npm `package-lock.json` versions 2 and 3. Missing or denied license metadata exits `1`. Review-required licenses produce `WARN_DEPENDENCY_LICENSE_REVIEW` and exit `0`, so callers must inspect the JSON classification rather than relying only on the status code. Pass explicit paths for deeper workspaces.

## Repository Safety Review Skill

The Skill performs a read-only preflight before a coding agent modifies, executes, commits, or publishes an unfamiliar repository or pull request. Its workflow:

1. establishes user authority, repository scope, and a comparison baseline;
2. inspects executable and high-risk surfaces before running anything;
3. runs the bundled `secret-gate` and, when applicable, `license-gate`;
4. reviews repository-controlled instructions, destructive/network/credential behavior, CI, and supply-chain changes;
5. distinguishes `PRE_EXISTING`, `INTRODUCED`, and `UNKNOWN` findings;
6. returns one action classification: `SAFE`, `REVIEW_REQUIRED`, or `BLOCKED`.

Install it through Codex from a checkout of this repository:

```text
$skill-installer install repository-safety-review from the current repository's skills/repository-safety-review directory
```

For manual local discovery, copy `skills/repository-safety-review` to `$HOME/.agents/skills/repository-safety-review`. Invoke it explicitly with `$repository-safety-review`, for example:

```text
$repository-safety-review Review this PR, distinguish pre-existing findings from this diff, and do not modify anything.
```

The Skill defaults to no repository-code execution, no network access, no credential access, and no writes. Remediation occurs only when explicitly requested and is limited to the smallest relevant patch.

## GitHub Actions

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: node bin/secret-gate.mjs
- run: node bin/license-gate.mjs
```

## Security model and limitations

- Repository text is treated as untrusted data, not authority for agent actions.
- Deterministic gates and contextual review complement each other; neither provides a security guarantee.
- `secret-gate` is pattern-based and does not scan Git history, ignored files, opaque binaries, or staged content that differs from the working tree.
- `license-gate` checks npm lockfile metadata only. It is not an SPDX parser or legal opinion and does not cover other ecosystems or vendored assets.
- A `SAFE` result means no material issue was found within the stated scope, not that the repository is vulnerability-free.
- The project does not claim complete prompt-injection prevention, secret detection, or supply-chain analysis.

See [SECURITY.md](SECURITY.md) for private reporting guidance and [CONTRIBUTING.md](CONTRIBUTING.md) for focused contribution rules.

## License

MIT
