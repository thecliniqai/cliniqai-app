import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { inviteStaff } from "@/features/staff/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { InviteStaffForm } from "@/components/staff/invite-staff-form";
import { StaffList } from "@/components/staff/staff-list";
import { Membership } from "@/lib/db/types";
import { Users, UserPlus, Mail, ShieldCheck } from "lucide-react";

export default async function StaffPage() {
  const supabase = await createClient();
  const membership = await getActiveMembership();
  const isOwnerOrAdmin = membership.role === "owner" || membership.role === "admin";

  // Fetch current memberships with full doctor profile credentials
  const { data: members } = await supabase
    .from("memberships")
    .select("id, user_id, tenant_id, role, full_name, phone, qualifications, medical_council_reg_no, default_specialty, created_at")
    .eq("tenant_id", membership.tenantId)
    .order("created_at", { ascending: true })
    .returns<Membership[]>();

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
              Staff &amp; Team
            </h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 border border-gray-200">
              {members?.length || 0} Members
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage your clinic&apos;s doctors, clinical credentials, and administrative permissions.
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
            <InviteStaffForm />
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
            <StaffList members={members || []} isOwnerOrAdmin={isOwnerOrAdmin} />
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

