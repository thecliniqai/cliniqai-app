// Lint-gate fixture (AUTH-01): must FAIL lint. Never imported or executed.
export function fixture(result: { code: string | null }) {
  const devOtpHint = result.code;
  return devOtpHint;
}
