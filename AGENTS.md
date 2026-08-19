# AGENTS.md

## Cursor Cloud specific instructions

This repository is `action-seqera-launch`: a TypeScript **GitHub Action** that launches
and monitors Seqera Platform workflows. It is bundled with rolldown into a single
`dist/index.js` that the GitHub Actions runtime executes. There is **no server or
long-running service** to start — "running the app" means executing the built bundle.

### Toolchain / Node version

- The project requires **Node 24** (`.node-version`, `engines.node >= 24`, `runs.using: node24`).
- The VM's default `node` on `PATH` (`/exec-daemon/node`) is Node 22. Node 24 is installed
  via `nvm` and made the default by symlinks in `/usr/local/cargo/bin` (first on `PATH`), so
  a fresh shell already resolves `node`/`npm`/`npx` to Node 24 — no manual `nvm use` needed.
  Verify with `node --version` (expect `v24.x`). This is a one-time setup baked into the
  environment snapshot; the startup update script only runs `npm ci`.
- Package manager is **npm** (`package-lock.json`); install with `npm ci`.

### Commands

All dev commands are the `scripts` in `package.json` (also mirrored by `.github/workflows/ci.yml`):

- `npm run all` runs the full CI-equivalent gate: `format:check` → `lint` → `lint:types` →
  `typecheck` → `test` → `build`. Run this before committing.
- Individual steps: `npm run format:check` (oxfmt), `npm run lint` / `npm run lint:types`
  (oxlint; **prints no output when clean**), `npm run typecheck` (tsc), `npm test` (vitest),
  `npm run build` (rolldown → `dist/index.js`).

### Non-obvious gotchas

- `dist/index.js` is **committed** and executed directly by the Actions runtime. After any
  change under `src/`, run `npm run build` and commit the regenerated `dist/`. The
  `check-dist` workflow (`.github/workflows/check-dist.yml`) fails CI if `dist/` is stale.
- To exercise the action locally, run `node dist/index.js`. It reads GitHub Actions
  conventions (`INPUT_*` env vars, `GITHUB_OUTPUT`) via `@actions/core`. The current scaffold
  intentionally calls `setFailed` and exits `1` with `::error::action-seqera-launch is not
implemented yet` — that is expected until the launch logic (issues #4/#5) lands.
