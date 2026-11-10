# AGENTS.md

A TypeScript GitHub Action that launches and monitors Seqera Platform workflows. Node 24, npm.

## Commands

- `npm ci` to install.
- `npm run all` runs everything CI runs: format, lint, type-aware lint, typecheck, tests, build. Run it before you commit.
- `npm run format` fixes formatting. Lint prints nothing when clean.

## Rules

- `dist/index.js` is committed. After changing `src/`, run `npm run build` and commit `dist/` too, or `check-dist` fails.
- Never hand-edit `dist/`, `src/api/schema.d.ts` (`npm run codegen`), or `openapi/` (pinned upstream spec).
- Don't dispatch the `Integration` workflow without permission: it creates real Platform runs.

## More

- Decisions: `docs/decisions/`
- Skills: `.agents/skills/` (verifying, releasing, Effect)
