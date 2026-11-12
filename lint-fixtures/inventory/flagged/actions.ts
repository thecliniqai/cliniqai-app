"use server";
// Inventory-gate fixture (F14, V2-02 02-01): must make `npm run inventory` exit 1. Never imported or executed.
// The acting tenant hides in a NAMED parameter type, which only the type-aware inventory sees (ESLint cannot).
type SaveNoteInput = { text: string; tenantId: string };

export async function saveNoteFixture(input: SaveNoteInput, clientOverride?: unknown) {
  return [input, clientOverride];
}
