"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Copy, Check, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { inviteStaff } from "@/features/staff/actions";

export function InviteStaffForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("doctor");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);
  const [lastInvitedEmail, setLastInvitedEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.append("email", email);
    formData.append("role", role);

    startTransition(async () => {
      const res = await inviteStaff(formData);
      if (res.success) {
        setLastInviteLink(res.inviteLink);
        setLastInvitedEmail(email);
        setEmail("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleCopy = () => {
    if (lastInviteLink) {
      navigator.clipboard.writeText(lastInviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
            <option value="admin">Admin (Operational & Staff Management)</option>
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
              <span>Send Invitation</span>
            </>
          )}
        </Button>
      </form>

      {/* Instant UAT Link Banner */}
      {lastInviteLink && (
        <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800">
              Invitation Created for {lastInvitedEmail}
            </span>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              UAT Mode Link
            </span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={lastInviteLink}
              className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-emerald-300 rounded-lg text-slate-800 select-all"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleCopy}
              className="h-8 gap-1.5 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-100 shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied" : "Copy Link"}</span>
            </Button>
          </div>

          <p className="text-[11px] text-emerald-700">
            Paste this link into an Incognito window to join directly. (Also printed to terminal console &amp; <code className="font-mono">.planning/dev-auth-logs.txt</code>)
          </p>
        </div>
      )}
    </div>
  );
}
