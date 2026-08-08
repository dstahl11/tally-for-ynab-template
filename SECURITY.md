# Security

Do not commit `.env`, SQLite databases, API keys, phone numbers, PINs, session
tokens, tunnel tokens, or backup credentials.

If you find a vulnerability, report it privately to the repository owner rather
than opening a public issue. Rotate any credential that may have been exposed.

## Maintainer checks

- `npm audit --omit=dev` must report zero production vulnerabilities before a
  release or live deployment.
- GitHub Dependabot, secret scanning, push protection, and CodeQL should remain
  enabled on the public repository.
- The runtime Docker image omits development dependencies and runs as the
  unprivileged `node` user.

`drizzle-kit` currently includes an `esbuild` development-server advisory in
its migration-generation toolchain. It is not installed in the production
image. Do not expose Drizzle's development server to untrusted networks; update
the toolchain when the upstream dependency is replaced.
