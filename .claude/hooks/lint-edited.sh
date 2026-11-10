#!/usr/bin/env bash
# PostToolUse(Edit|Write|MultiEdit): format the edited file, then report lint errors (not pedantic warnings) on it.
file=$(node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(i.tool_input?.file_path??"")')
cd "$CLAUDE_PROJECT_DIR" || exit 0
rel=${file#"$CLAUDE_PROJECT_DIR"/}

case $rel in
  src/*.ts | test/*.ts | *.config.ts) ;;
  *) exit 0 ;;
esac
[ "$rel" = src/api/schema.d.ts ] && exit 0

if [ ! -x node_modules/.bin/oxlint ]; then
  echo 'node_modules is missing, so this edit was not linted. Run `npm ci`.' >&2
  exit 2
fi

node_modules/.bin/oxfmt "$rel" >/dev/null 2>&1
if ! out=$(node_modules/.bin/oxlint --quiet --type-aware "$rel" 2>&1); then
  printf 'Lint errors in %s (fix before moving on; CI runs the same rules):\n%s\n' "$rel" "$out" >&2
  exit 2
fi
