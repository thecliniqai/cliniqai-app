#!/bin/bash
# 03-13d M-ERRMSG census: every read of an error object's `.message` in the sweep scope (features/** except auth and
# billing; app/** except app/api/v1, app/api/ready and the auth routes; plus lib/messaging, lib/storage, lib/webhooks).
# Usage: bash errmsg-count.sh   (run from the repo root)
rg -n --pcre2 '\b\w*(?:err|Err|error|Error|\be)\??\.message\b' features app lib/messaging lib/storage lib/webhooks \
  -g '!features/auth/**' -g '!features/billing/**' -g '!app/api/v1/**' -g '!app/api/ready/**' \
  -g '!app/(auth)/**' -g '!app/auth/**' -g '!app/api/auth/**' | sort
