import { NextResponse } from "next/server";

import { CLINIC_CHANGED_CODE, TENANT_HEADER } from "./clinic-header";

/** The refusal for a read made for another clinic than the session's; null when the header is absent (an old client) or matches. */
export function clinicChangedResponse(request: Request, sessionTenantId: string, headers: Record<string, string>): NextResponse | null {
  const claimed = request.headers.get(TENANT_HEADER);
  if (claimed === null || claimed === sessionTenantId) return null;
  return NextResponse.json({ error: "The clinic changed.", code: CLINIC_CHANGED_CODE }, { status: 409, headers });
}
