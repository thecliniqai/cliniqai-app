// AI-L1 fixture (L1-R3, widened in V2-03 03-10): a test-runner branch anywhere in lib/ must fail the check.
const skipDnsUnderTests = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
export const resolveOnlyInProduction = !skipDnsUnderTests;
