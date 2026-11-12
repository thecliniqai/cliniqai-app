# 02-01 step 9 — GitHub settings commands (orchestrator only)

Apply **only after** `ci.yml` is green on the phase PR (all five checks `static`, `security`, `test`, `build`, `e2e`
have reported at least once, so the required-check names exist). Rulings RL-3…RL-8, OA-3. Repo:
`thecliniqai/cliniqai-app` (public, org on GitHub Free). State read on 2026-11-12: default branch `main`; one
ruleset `v2rules` (id 26947233, active); Actions `{"enabled":true,"allowed_actions":"all","sha_pinning_required":false}`;
secret scanning and push protection disabled.

Every command writes its JSON response under the phase evidence directory (tool output, never hand-typed).

```bash
R=thecliniqai/cliniqai-app
E=.planning/phases/02-ci-e2e-foundations/evidence/github-settings
mkdir -p "$E"
```

## 0. Before-state snapshots (for the "main protections unchanged" diff)

```bash
gh api "repos/$R" --jq '{default_branch, visibility, security_and_analysis}' > "$E/00-repo-before.json"
gh api "repos/$R/rulesets" > "$E/00-rulesets-before.json"
gh api "repos/$R/rulesets/26947233" > "$E/00-v2rules-before.json"
gh api "repos/$R/rules/branches/main" > "$E/00-main-rules-before.json"
gh api "repos/$R/rules/branches/feature/v2" > "$E/00-feature-v2-rules-before.json"
gh api "repos/$R/actions/permissions" > "$E/00-actions-permissions-before.json"
```

## a. Default branch → `feature/v2` (RL-3; nightly cron runs only on the default branch)

```bash
gh api -X PATCH "repos/$R" -f default_branch=feature/v2 \
  --jq '{default_branch}' > "$E/a-default-branch.json"
```

## b. Ruleset `feature-v2-ci` on `feature/v2` only (RL-4, RL-5, RL-6). `v2rules` is NOT modified.

`integration_id` 15368 is the GitHub Actions app: only Actions can satisfy these checks (a commit status with the same
name posted by another app or token does not count).

```bash
cat > /tmp/feature-v2-ci.json <<'JSON'
{
  "name": "feature-v2-ci",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/feature/v2"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "static", "integration_id": 15368 },
          { "context": "security", "integration_id": 15368 },
          { "context": "test", "integration_id": 15368 },
          { "context": "build", "integration_id": 15368 },
          { "context": "e2e", "integration_id": 15368 }
        ]
      }
    }
  ]
}
JSON
gh api -X POST "repos/$R/rulesets" --input /tmp/feature-v2-ci.json > "$E/b-ruleset-feature-v2-ci.json"
```

## c. Secret scanning + push protection (free on public repos)

```bash
gh api -X PATCH "repos/$R" --input - --jq '{security_and_analysis}' > "$E/c-secret-scanning.json" <<'JSON'
{ "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
```

## d. Actions policy: SHA pinning required (RL-8)

```bash
gh api -X PUT "repos/$R/actions/permissions" \
  -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
gh api "repos/$R/actions/permissions" > "$E/d-actions-permissions.json"
```

## e. Not changed here

Dependabot stays with P1-19 (V2-12). Visibility stays with the PO (RL-6b / OA-3: upgrade the org to GitHub Team
before making the repo private, or rulesets stop enforcing).

## After-state + diff (acceptance: `main` protections unchanged)

```bash
gh api "repos/$R/rulesets" > "$E/z-rulesets-after.json"
gh api "repos/$R/rulesets/26947233" > "$E/z-v2rules-after.json"
gh api "repos/$R/rules/branches/main" > "$E/z-main-rules-after.json"
gh api "repos/$R/rules/branches/feature/v2" > "$E/z-feature-v2-rules-after.json"
# Expect no output (updated_at aside) for v2rules and main:
diff <(jq 'del(.updated_at, ._links)' "$E/00-v2rules-before.json") <(jq 'del(.updated_at, ._links)' "$E/z-v2rules-after.json")
diff <(jq -S . "$E/00-main-rules-before.json") <(jq -S . "$E/z-main-rules-after.json")
```

`feature/v2` rules after = v2rules' rules + the four `feature-v2-ci` rules. Nightly: the first scheduled run after (a)
is the acceptance link (`gh run list --workflow nightly.yml --event schedule --limit 1`).

## Applied (orchestrator, 2026-11-12) — CI run 43198582433 green (`evidence/02-01/ci-run.json`)
- 0, a, c, d applied; responses in `evidence/github-settings/`.
- **b (ruleset `feature-v2-ci`) deferred until PR #3 (V2-01) merges.** PR #3's head branch has no `ci.yml`, so the five
  required checks would never report on it and, with no bypass actors, #3 could not be merged. Apply b immediately
  after #3 merges and #4 is retargeted to `feature/v2`, then run the after-state diff.

- **b applied** 2026-11-13 after PR #3 merged (`e01c39b`): ruleset `feature-v2-ci` id 27150224, active; `v2rules` and `main` rules unchanged (diff empty); responses `evidence/github-settings/b-ruleset-feature-v2-ci.json`, `z-*-after.json`.
