#!/bin/sh
# The quality gate: everything must pass before a commit. Builds the library, runs the core and
# web unit tests, then the browser scenarios against the dev server (cd web && npm run dev)
# in a Chrome started with --remote-debugging-port=9333. Prints GATE OK and the number of
# browser checks when all is well.
set -e
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy ALL_PROXY all_proxy
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
npx tsc
jest_out=$(npx jest 2>&1) || { echo "$jest_out" | tail -30; exit 1; }
echo "$jest_out" | grep -E "^Tests:.*failed" && exit 1
cd web
npx tsc --noEmit -p .
web_out=$(npm test 2>&1) || true
echo "$web_out" | grep -q "^ℹ fail 0" || { echo "$web_out" | grep -B2 -A12 "✖" | head -40; exit 1; }
all=""
for s in regress regress2 regress3 regress4; do
  # A connection refused by the sandbox now and then is not a test failure: try once more.
  out=$(node scripts/drive.mjs "scripts/scenarios/$s.mjs" 2>&1) || true
  for retry in 1 2 3; do
    echo "$out" | grep -q "EPERM" || break
    sleep 3
    out=$(node scripts/drive.mjs "scripts/scenarios/$s.mjs" 2>&1) || true
  done
  if echo "$out" | grep -q "SCENARIO FAILED\|ERRORS:" || ! echo "$out" | grep -q "^ok"; then echo "$s:"; echo "$out" | grep -v "^ok" | head -30; exit 1; fi
  all="$all
$out"
done
# No em dashes anywhere in the sources or the docs.
if grep -rn "—" src public tests scripts ../src ../tests ../README.md ../DSL.md ../SPEC.md >/dev/null 2>&1; then echo "em dash found"; exit 1; fi
echo "GATE OK ($(echo "$all" | grep -c '^ok') e2e checks)"
