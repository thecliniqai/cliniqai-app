// Semgrep fixture (V2-14 14-02).
export function filters(query: Query, doctorId: string) {
  // ruleid: postgrest-or-interpolation
  query.or(`doctor_id.eq.${doctorId},doctor_id.is.null`);

  // ok: postgrest-or-interpolation
  query.or("doctor_id.is.null,status.eq.open");

  // ok: postgrest-or-interpolation
  query.eq("doctor_id", doctorId);
}
