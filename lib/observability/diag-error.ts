/**
 * The synthetic error `POST /api/diag/error` throws (V2-03 03-09b, R-18). Every value in it is synthetic and is one
 * the scrubber must remove before the sink stores the message: a +91 mobile in a Postgres `Key (…)=(…)` detail, an
 * email, a spaced 0-prefixed mobile and a share-style query string. The specs assert none of them survives.
 */
export const DIAG_SYNTHETIC = {
  phone: "+919000000000",
  spacedPhone: "090000 00000",
  email: "diag.synthetic@example.com",
  queryToken: "diagSyntheticToken0123456789",
} as const;

/**
 * The `Key (…)=(…)` detail comes last: the scrubber redacts everything after it (03-13d), so the email, mobile and query
 * rules are proven on the text before it.
 */
export const DIAG_ERROR_MESSAGE =
  `Diagnostic error (synthetic): contact ${DIAG_SYNTHETIC.email}, mobile ${DIAG_SYNTHETIC.spacedPhone}, ` +
  `link /r/abc?token=${DIAG_SYNTHETIC.queryToken}; ` +
  `duplicate key value violates unique constraint "patients_phone_key" Key (phone)=(${DIAG_SYNTHETIC.phone}) already exists.`;

export class DiagnosticError extends Error {
  readonly code = "DIAG_SYNTHETIC";

  constructor() {
    super(DIAG_ERROR_MESSAGE);
    this.name = "DiagnosticError";
  }
}
