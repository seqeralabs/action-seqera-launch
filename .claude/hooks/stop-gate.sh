#!/usr/bin/env bash
# Stop: when this branch touches code, run the CI gate and catch a stale dist/ before Claude reports done.
active=$(node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(String(i.stop_hook_active??false))')
[ "$active" = true ] && exit 0 # already blocked once this turn; don't loop
cd "$CLAUDE_PROJECT_DIR" || exit 0

base=$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)
code='^(src/|test/|package(-lock)?\.json$|tsconfig\.json$|rolldown\.config\.ts$|\.oxlintrc\.json$)'
changed=$({ git diff --name-only "$base"; git ls-files --others --exclude-standard; } | grep -E "$code")
[ -z "$changed" ] && exit 0

if [ ! -x node_modules/.bin/oxlint ]; then
  echo 'Code changed but node_modules is missing, so nothing was checked. Run `npm ci`, then the gate runs on stop.' >&2
  exit 2
fi

fail() {
  printf '`npm run %s` failed. Fix it before finishing:\n%s\n' "$1" "$(tail -n 40 <<<"$2")" >&2
  exit 2
}
for step in typecheck lint:types test format:check; do
  out=$(npm run -s "$step" 2>&1) || fail "$step" "$out"
done

before=$(git hash-object dist/index.js)
out=$(npm run -s build 2>&1) || fail build "$out"
if [ "$(git hash-object dist/index.js)" != "$before" ]; then
  echo 'dist/index.js was stale relative to src/ and has now been rebuilt. Include dist/ alongside the src/ change, or check-dist fails CI.' >&2
  exit 2
fi
