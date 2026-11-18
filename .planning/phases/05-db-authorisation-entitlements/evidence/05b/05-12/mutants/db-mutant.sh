#!/bin/bash
S=/private/tmp/claude-501/-Users-sid-Code-clinicOS/97b5a715-150e-4316-bfca-6aa56dca516e/scratchpad/0512
cd /Users/sid/Code/clinicOS
PSQL=(docker exec -i supabase_db_clinicos psql -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" < $S/mut/ai-period-mutant.sql || exit 8
npx supabase test db --local supabase/tests/database/review_fixes_05b.test.sql > $S/mut/pgtap-mutant-ai-period.tap 2>&1
"${PSQL[@]}" < $S/mut/ai-period-restore.sql || { echo "RESTORE FAILED"; exit 9; }
node scripts/drift/schema-snapshot.mjs --local --check > $S/mut/snapshot-check-after-mutant.txt 2>&1; echo "snapshot-check $?" >> $S/mut/snapshot-check-after-mutant.txt
