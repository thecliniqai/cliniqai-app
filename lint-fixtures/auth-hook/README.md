# Send Email hook payload fixtures (V2-03 03-11b)

Synthetic Supabase Auth Send Email hook bodies, one per `email_action_type`, used by
`tests/auth/send-email-hook.spec.ts`, `tests/integration/auth/mailpit-sender.spec.ts`, the `webhook-signature` guard
leg and `tests/e2e/auth/send-email-hook.spec.ts`. Key lists follow the AUTH-00 spike E3 (`metadata`, `user`,
`email_data` with `token, token_hash, redirect_to, email_action_type, site_url, token_new, token_hash_new, old_email,
old_phone, provider, factor_type`) and the shapes GoTrue v2.197.0 sent to a local receiver in 03-11b
(`.planning/phases/03-platform-hygiene/evidence/03-11b/gotrue-hook-shapes.jsonl`): `password_changed_notification`
has no token; `email_change` carries `token` for the current address and `token_new` for `user.new_email`.

Every value is synthetic: `@example.com` addresses, fixed UUIDs, all-zero token hashes, documentation-range IP. Codes
are distinct per fixture so a test can tell which one reached which address.
