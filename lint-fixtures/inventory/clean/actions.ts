"use server";
// Inventory-gate fixture (F14, V2-02 02-01): must leave `npm run inventory` at exit 0. Never imported or executed.
// Target ids are allowed; the acting principal would come from the session inside the action.
type SaveNoteInput = { text: string; patientId: string; target_tenant_id?: string };

export async function saveNoteFixture(input: SaveNoteInput) {
  return input;
}
