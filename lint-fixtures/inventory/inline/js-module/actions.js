"use server";
// Inventory-gate fixture (P0-13, V2-02 02-06): a "use server" module that is not TypeScript, so the inventory cannot
// read its exports. Never imported.
export async function saveNoteFixture(note) {
  return note;
}
