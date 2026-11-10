#!/usr/bin/env bash
# PreToolUse(Edit|Write|MultiEdit): generated files are rebuilt from source, never hand-edited.
file=$(node -e 'const i=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(i.tool_input?.file_path??"")')
rel=${file#"$CLAUDE_PROJECT_DIR"/}

case $rel in
  dist/*) fix='Edit src/ and run `npm run build`; check-dist fails CI if dist/ differs from a fresh build.' ;;
  src/api/schema.d.ts) fix='Run `npm run codegen` (generated from openapi/). Hand-written API types belong in src/api/schemas/.' ;;
  openapi/*) fix='This is the pinned upstream Seqera spec; replace it with a new upstream version, then run `npm run codegen`.' ;;
  *) exit 0 ;;
esac

echo "Blocked: $rel is generated or vendored, not hand-edited. $fix" >&2
exit 2
