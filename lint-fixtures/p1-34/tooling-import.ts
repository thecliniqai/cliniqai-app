// @ts-nocheck: these modules exist only as laundering probes; the gate refuses the import whatever it resolves to.
import { systemDb } from "@/lint-fixtures/p1-34/factory-import";
import { launder } from "@/scripts/launder";
import { getAdminClient } from "../../tests/helpers/supabase-admin";
import { notes } from "@/docs/notes";
export const probes = [systemDb, launder, getAdminClient, notes];
