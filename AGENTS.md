# AGENTS.md

A TypeScript GitHub Action that launches and monitors Seqera Platform workflows. Node 24, npm.

## Commands

- `npm ci` to install.
- `npm run all` runs everything CI runs: format, lint, type-aware lint, typecheck, tests, build. Run it before you commit.
- `npm run format` fixes formatting. Lint prints nothing when clean.

## Rules

Each rule names what enforces it. When a rule has no enforcement and it gets broken again, add a check instead of more words here. Once a mistake can't happen any more, delete its rule.

| Rule                                                                                                                                           | Enforced by                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `dist/index.js` is committed. After changing `src/`, run `npm run build` and commit `dist/` too.                                               | `check-dist` CI; Stop hook rebuilds and blocks if `dist/` was stale |
| Never hand-edit `dist/`, `src/api/schema.d.ts` (`npm run codegen`), or `openapi/` (pinned upstream spec).                                      | PreToolUse hook `guard-generated.sh`                                |
| `Integration` creates real Platform runs. It runs on every push to a PR (or `main`), so ask before pushing to a PR, and before dispatching it. | `ask` permission on `gh workflow run` only; pushes are unguarded    |

## More

- Decisions: `docs/decisions/`
- Skills: `.agents/skills/` (verifying, releasing, Effect)
