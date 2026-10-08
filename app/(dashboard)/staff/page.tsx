import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { inviteStaff } from "@/features/staff/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Users, UserPlus, Mail, ShieldCheck } from "lucide-react";

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

  const getRoleBadge = (role: string) => {
    switch (role.toLowerCase()) {
      case "owner":
        return <Badge color="primary" size="sm">Owner</Badge>;
      case "doctor":
        return <Badge color="info" size="sm">Doctor</Badge>;
      case "admin":
        return <Badge color="primary" size="sm">Admin</Badge>;
      case "nurse":
        return <Badge color="success" size="sm">Nurse</Badge>;
      case "receptionist":
        return <Badge color="warning" size="sm">Receptionist</Badge>;
      default:
        return <Badge color="gray" size="sm" className="capitalize">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Staff & Team
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
              {members?.length || 0} Members
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your clinic&apos;s doctors, nurses, and administrative staff permissions.
          </p>
        </div>
      </div>

      {/* Invite New Staff Member */}
      {isOwnerOrAdmin && (
        <Card className="max-w-xl">
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center text-brand-600 border border-brand-100">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Invite New Staff Member</CardTitle>
                <CardDescription>
                  Send a secure email invitation with role-based clinical permissions
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
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
                  className="w-full h-11 px-3.5 text-sm rounded-lg border border-gray-300 bg-white text-gray-900 shadow-theme-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                >
                  <option value="doctor">Doctor (Clinical Consultations & Prescriptions)</option>
                  <option value="admin">Admin (Operational & Staff Management)</option>
                  <option value="receptionist">Receptionist (Intake, Front Desk & Scheduling)</option>
                  <option value="nurse">Nurse (Vitals, Triage & Assistant)</option>
                </select>
              </Field>

              <Button type="submit" variant="primary" className="w-full sm:w-auto">
                <Mail className="w-4 h-4 mr-2" />
                Send Invitation
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Team Tables Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active Members */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-500" />
                <CardTitle>Active Members</CardTitle>
              </div>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {members?.length || 0}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-gray-100">
              {members?.map((m) => (
                <div key={m.id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-brand-50 border border-brand-100 text-brand-600 flex items-center justify-center font-bold text-xs shrink-0">
                      {m.role.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">
                        User {m.user_id.slice(0, 8)}...
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        Joined {new Date(m.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div>{getRoleBadge(m.role)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Pending Invites */}
        {isOwnerOrAdmin && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-600" />
                  <CardTitle>Pending Invitations</CardTitle>
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                  {invitations.length}
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {invitations.length === 0 ? (
                <div className="p-8 text-center text-xs text-gray-500">
                  No pending invitations. All invited staff have activated their accounts.
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {invitations.map((inv) => (
                    <div key={inv.id} className="p-4 sm:px-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {inv.invited_address}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          Expires {new Date(inv.expires_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div>{getRoleBadge(inv.role)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

