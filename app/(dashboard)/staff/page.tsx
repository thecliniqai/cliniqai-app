import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { inviteStaff } from "@/features/staff/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export default async function StaffPage() {
  const supabase = await createClient();
  const membership = await getActiveMembership();
  const isOwnerOrAdmin = membership.role === "owner" || membership.role === "admin";

  // Fetch current memberships
  const { data: members } = await supabase
    .from("memberships")
    .select("id, user_id, role, created_at")
    .eq("tenant_id", membership.tenantId)
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; user_id: string; role: string; created_at: string }>>();

  // Fetch pending invitations if owner/admin
  let invitations: Array<{ id: string; invited_address: string; role: string; expires_at: string; consumed_at: string | null }> = [];
  if (isOwnerOrAdmin) {
    const { data: invites } = await supabase
      .from("invitations")
      .select("id, invited_address, role, expires_at, consumed_at")
      .eq("tenant_id", membership.tenantId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .returns<Array<{ id: string; invited_address: string; role: string; expires_at: string; consumed_at: string | null }>>();

    invitations = invites || [];
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Staff & Team</h1>
        <p className="text-sm text-[#666] mt-1">
          Manage your clinic&apos;s doctors, nurses, and administrative staff.
        </p>
      </div>

      {isOwnerOrAdmin && (
        <section className="bg-white border border-[#E5E4E0] rounded-lg p-6 max-w-xl">
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-4">Invite New Staff Member</h2>
          <form
            action={async (formData: FormData) => {
              "use server";
              await inviteStaff(formData);
            }}
            className="space-y-4"
          >
            <Field label="Staff Email Address" htmlFor="email" required>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="doctor@example.com"
              />
            </Field>

            <Field label="Assigned Role" htmlFor="role" required>
              <select
                id="role"
                name="role"
                required
                defaultValue="doctor"
                className="w-full h-11 px-3 rounded-md border border-[#D1D0CB] bg-white text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1769E0]"
              >
                <option value="doctor">Doctor</option>
                <option value="admin">Admin</option>
                <option value="receptionist">Receptionist</option>
                <option value="nurse">Nurse</option>
              </select>
            </Field>

            <Button type="submit" variant="primary" className="w-full">
              Send Invitation
            </Button>
          </form>
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Active Members */}
        <section className="bg-white border border-[#E5E4E0] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-4">
            Active Members ({members?.length || 0})
          </h2>
          <div className="divide-y divide-[#E5E4E0]">
            {members?.map((m) => (
              <div key={m.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-[#1A1A1A]">
                    User {m.user_id.slice(0, 8)}...
                  </div>
                  <div className="text-xs text-[#777]">
                    Joined {new Date(m.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-xs font-semibold uppercase px-2 py-1 rounded bg-[#F0EFEA] text-[#444]">
                  {m.role}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Pending Invites */}
        {isOwnerOrAdmin && (
          <section className="bg-white border border-[#E5E4E0] rounded-lg p-6">
            <h2 className="text-lg font-semibold text-[#1A1A1A] mb-4">
              Pending Invitations ({invitations.length})
            </h2>
            {invitations.length === 0 ? (
              <p className="text-sm text-[#777]">No pending invitations.</p>
            ) : (
              <div className="divide-y divide-[#E5E4E0]">
                {invitations.map((inv) => (
                  <div key={inv.id} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-[#1A1A1A]">
                        {inv.invited_address}
                      </div>
                      <div className="text-xs text-[#777]">
                        Expires {new Date(inv.expires_at).toLocaleDateString()}
                      </div>
                    </div>
                    <span className="text-xs font-semibold uppercase px-2 py-1 rounded bg-[#EBF3FE] text-[#1769E0]">
                      {inv.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
