"use server";
// Semgrep fixture (V2-14 14-02): `semgrep --test` checks every `ruleid:` line matches and every `ok:` line does not.

// ruleid: server-action-override-param
export async function saveNote(visitId: string, tenantIdOverride: string) {
  return { visitId, tenantIdOverride };
}

// ruleid: server-action-override-param
export async function listRows(input: { q: string }, db: SupabaseClient) {
  return { input, db };
}

// ruleid: server-action-override-param
export const markDone = async (id: string, actorSession: Session) => {
  return { id, actorSession };
};

// ok: server-action-override-param
export async function saveVitals(visitId: string, input: { pulse: number }) {
  return { visitId, input };
}
