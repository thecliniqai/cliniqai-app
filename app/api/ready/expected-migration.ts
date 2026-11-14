/**
 * The newest migration this build of the app was written against (V2-03 03-13c, M-PROBE). `/api/ready` asks the
 * database whether exactly this version is applied (`readiness_probe(p_expected_migration)`, migration 000029), so a
 * deploy that is ahead of its schema answers 503 without the version ever leaving the server.
 *
 * Bump it in the same commit as every new file in `supabase/migrations/`: tests/api/readiness-probe-db.spec.ts fails
 * when it is not the newest migration number.
 */
export const EXPECTED_MIGRATION = "000074";
