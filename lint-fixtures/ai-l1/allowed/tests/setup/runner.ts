// AI-L1 fixture: test code may read the runner flag; L1-R3 covers app code only (app/ components/ features/ lib/ proxy.ts).
export const underVitest = Boolean(process.env.VITEST);
