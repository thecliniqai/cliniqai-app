export const appUrl = process.env.NEXT_PUBLIC_APP_URL;
export const bracketed = process["env"];
const { env } = process;
export const destructured = env;
export const viaGlobal = globalThis.process.env;
