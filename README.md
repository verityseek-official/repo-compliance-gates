# repo-compliance-gates

Lightweight, zero-dependency command-line gates for two common repository
compliance checks:

- `secret-gate` — detects accidental secret material in a git working tree.
- `license-gate` — reviews dependency license metadata in npm lockfiles.

Both tools are plain Node.js scripts with no runtime dependencies, designed to
run in CI or a pre-commit hook. They were originally built as internal
development tooling for a larger software project and were extracted into
this standalone repository.

## Requirements

- Node.js 18 or newer
- `git` on `PATH` (required by `secret-gate`)

## Install

The repository has no package dependencies. Clone it and run the tools
directly, or link them into `PATH`:

```sh
npm link
```

## Usage

### secret-gate

Scans git tracked files and untracked, non-ignored text files for common
credential patterns:

- private key blocks
- AWS access keys
- GitHub tokens
- provider API keys
- Stripe live secrets
- Google API keys
- npm `_authToken` values
- credential-bearing URLs

Files named `.env*` (except `.env.example` and `.env.sample`) are rejected even
when untracked.

```sh
node bin/secret-gate.mjs
```

Exit code `0` means no findings; `1` means findings were reported. Matched
values are never echoed; only `file:line:rule` is printed.

### license-gate

Reads npm `package-lock.json` files (lockfile version 3). Without arguments,
it checks `package-lock.json` in the current directory and in immediate
subdirectories (for monorepos). Pass explicit paths to scan specific files:

```sh
node bin/license-gate.mjs
node bin/license-gate.mjs path/to/package-lock.json
```

Exit codes:

- `0` — no missing or denied licenses (review-required licenses produce a warning)
- `1` — missing license metadata, denied licenses, invalid lockfiles, or no lockfiles found

## GitHub Actions

```yaml
name: compliance

on:
  push:
  pull_request:

jobs:
  gates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node bin/secret-gate.mjs
      - run: node bin/license-gate.mjs
```

## Limitations

- `secret-gate` is pattern-based. It reduces the risk of accidental credential
  exposure; it is not a substitute for secret management, rotation, or a
  dedicated secret scanner.
- `license-gate` inspects npm lockfile metadata only. It does not perform a
  legal review of licenses, and its policy is intentionally conservative.
- Neither tool provides security or legal guarantees.

## Contributing

Keep the project small: zero runtime dependencies, focused behavior, and tests
for every change. Synthetic fixtures in tests must not contain real
credentials.

## Security

If you find a vulnerability, or a way the scanner can miss material it should
catch, open an issue. Do not include real credentials in reports or fixtures.

## License

MIT
