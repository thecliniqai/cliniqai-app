#!/bin/bash
# 05-12 app "without" proofs: each source file reverted to HEAD (1612ff6, before 05-12) for one run of its specs, then
# restored from the backup (cmp checked). Runs inside withlock.ts (the suites use a nested lock dir).
set -u
S=/private/tmp/claude-501/-Users-sid-Code-clinicOS/97b5a715-150e-4316-bfca-6aa56dca516e/scratchpad/0512
M=$S/mut
cd /Users/sid/Code/clinicOS
run() {
  local name="$1" file="$2"; shift 2
  cp "$file" "$M/$name.keep"
  git show "1612ff6:$file" > "$file"
  TMPDIR="$M/locktmp" npx vitest run "$@" > "$M/vitest-without-$name.log" 2>&1
  echo "$name exit $?" >> "$M/summary.txt"
  cp "$M/$name.keep" "$file"
  cmp -s "$M/$name.keep" "$file" && echo "$name restored" >> "$M/summary.txt" || { echo "$name RESTORE FAILED" >> "$M/summary.txt"; exit 9; }
}
mkdir -p "$M/locktmp"; : > "$M/summary.txt"
run api-key-creator lib/api/auth.ts tests/subscriptions/lock-enforcement.spec.ts -t "creator"
run inbound-locked "app/api/webhooks/messaging/[provider]/route.ts" tests/messaging/msg91-webhook.spec.ts -t "Locked clinic"
run page-precheck lib/auth/page.ts tests/subscriptions/locked-redirects.spec.ts -t "before its loader runs"
run staff-actions features/staff/actions.ts tests/staff/reinvite-role.spec.ts tests/integration/auth/remove-member.spec.ts -t "locked clinic|another role|already pending|again"
run turnstile-action features/auth/invite-flows.ts tests/auth/turnstile-verify.spec.ts -t "invite acceptance names its action"
run turnstile-lib lib/auth/turnstile.ts tests/auth/turnstile-verify.spec.ts -t "action"
run sub-d6-app features/sharing/public-links.ts tests/subscriptions/lock-enforcement.spec.ts -t "metadata only"
run copy-ids messages/en.ts tests/subscriptions/locked-redirects.spec.ts -t "internal id"
run entitlement-limit lib/entitlements/require-entitlement.ts tests/subscriptions/lock-enforcement.spec.ts -t "limits are numbers"
echo done >> "$M/summary.txt"
