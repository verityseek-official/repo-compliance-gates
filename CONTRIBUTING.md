# Contributing

Keep changes focused on repository compliance gates and agent-safe maintenance review.

- Preserve the zero npm runtime-dependency principle and Node.js 18 support.
- Add or update tests for every behavior or Skill contract change.
- Use synthetic fixtures only. Never commit real tokens, cookies, passwords, private keys, credential-bearing URLs, or customer data.
- Construct secret-like test values at runtime so the repository's own gate remains clean.
- Inspect package scripts and test commands before running them.
- Keep `bin/secret-gate.mjs` and `bin/license-gate.mjs` as supported public entry points.
- Keep the Skill self-contained, standards-compatible, read-only by default, and accurate about limitations.
- Avoid unrelated features, runtime dependencies, generated artifacts, or claims of guaranteed protection.

Before opening a pull request, run:

```sh
npm test
node bin/secret-gate.mjs
node bin/license-gate.mjs
```

Do not report security vulnerabilities or real credentials in a public issue. Follow [SECURITY.md](SECURITY.md).
