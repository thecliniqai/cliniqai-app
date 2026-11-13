declare const row: { created_at: string };
const now = new Date();
export const a = now.toISOString().split("T")[0];
export const b = now.toISOString().slice(0, 10);
export const c = now.toISOString().substring(0, 10);
export const d = row.created_at.split("T")[0];
export const e = `${a}T00:00:00Z`;
export const f = `${a}T23:59:59.999Z`;
export const g = "2026-11-13T00:00:00+05:30";
