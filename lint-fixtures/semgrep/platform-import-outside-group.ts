// Semgrep fixture (V2-14 14-02).
// ruleid: platform-import-outside-group
import { listClinics } from "@/features/platform/service";
// ruleid: platform-import-outside-group
import * as admin from "@/lib/platform/admin";
// ok: platform-import-outside-group
import { isStandalone } from "@/lib/pwa/platform";

export const used = [listClinics, admin, isStandalone];
