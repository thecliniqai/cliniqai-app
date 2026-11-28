/**
 * The clinic a client believes it is reading (V2-09e 09E-14a, finding A). A tab opened before a clinic switch in another tab still
 * holds the old clinic's screens; its next read is answered for the session's clinic (the new one) and would be stored under the old
 * clinic's key. The client therefore names its clinic on every board and live-state read, and the route answers `409 CLINIC_CHANGED`
 * (a fixed body, no data, no id) when the name is not the session's clinic. The header is never a tenant selector: the clinic is still
 * derived from the session; the header can only make a read fail.
 */
export const TENANT_HEADER = "x-clinicos-tenant";
export const CLINIC_CHANGED_CODE = "CLINIC_CHANGED";
