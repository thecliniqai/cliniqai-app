"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { inviteStaff, type InviteStaffOutcome } from "@/features/staff/actions";

const ROLE_LABELS: Record<string, string> = {
  owner: "owner",
  admin: "admin",
  doctor: "doctor",
  receptionist: "receptionist",
  nurse: "nurse",
};

/** What the owner is told (V2-05 05-12, M-REINVITE): a new invitation, a replaced one, or one already pending. */
function inviteNotice(email: string, role: string, outcome: InviteStaffOutcome, previousRole?: string): string {
  const asRole = ROLE_LABELS[role] ?? role;
  if (outcome === "replaced") {
    return `The pending ${ROLE_LABELS[previousRole ?? ""] ?? "earlier"} invitation for ${email} was cancelled. A new ${asRole} invitation was sent.`;
  }
  if (outcome === "already_pending") {
    return `An invitation for ${email} as ${asRole} is already pending. No new email was sent; resend it from the list if needed.`;
  }
  return `Invitation created for ${email}.`;
}

/** `canInviteAdmin`: only owners may invite an admin (P0-02); the server and the database enforce it too. */
export function InviteStaffForm({ canInviteAdmin = false }: { canInviteAdmin?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("doctor");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const formData = new FormData();
    formData.append("email", email);
    formData.append("role", role);

    startTransition(async () => {
      const res = await inviteStaff(formData);
      if (res.success) {
        setNotice(inviteNotice(email.trim(), role, res.outcome, res.previousRole));
        setEmail("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Staff Email Address" htmlFor="email" required>
          <Input
            id="email"
            name="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="doctor@example.com"
          />
        </Field>

        <Field label="Assigned Role" htmlFor="role" required>
          <select
            id="role"
            name="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-11 px-3.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          >
            <option value="doctor">Doctor (Clinical Consultations & Prescriptions)</option>
            {canInviteAdmin && <option value="admin">Admin (Operational & Staff Management)</option>}
            <option value="receptionist">Receptionist (Intake, Front Desk & Scheduling)</option>
            <option value="nurse">Nurse (Vitals, Triage & Assistant)</option>
          </select>
        </Field>

        {error && (
          <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          disabled={isPending}
          className="w-full sm:w-auto gap-2"
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating Invitation...</span>
            </>
          ) : (
            <>
              <Mail className="w-4 h-4" />
              <span>Create Invitation</span>
            </>
          )}
        </Button>
      </form>

      <div aria-live="polite">
        {notice && (
          <div
            className="flex items-start gap-2 p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-emerald-800"
            data-testid="invite-staff-notice"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        )}
      </div>
    </div>
  );
}
