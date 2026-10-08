import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership, NoClinicMembershipError } from "@/lib/auth/tenant";
import { getVisitsForDate } from "@/features/visits/actions";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { TableContainer, Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Users,
  Clock,
  Calendar,
  UserPlus,
  ArrowRight,
  TrendingUp,
  Activity,
} from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  let membership;
  try {
    membership = await getActiveMembership();
  } catch (error) {
    if (error instanceof NoClinicMembershipError) {
      redirect("/clinic/new");
    }
    throw error;
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, id")
    .eq("id", membership.tenantId)
    .maybeSingle<{ name: string; id: string }>();

  // Fetch metrics: Total patients
  const { count: patientCount } = await supabase
    .from("patients")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", membership.tenantId);

  // Today's date
  const today = new Date().toISOString().split("T")[0];
  const visitsRes = await getVisitsForDate(today);
  const visits = visitsRes.success ? visitsRes.visits : [];

  const waitingCount = visits.filter((v) => v.status === "waiting").length;
  const inConsultCount = visits.filter((v) => v.status === "in_consultation").length;
  const completedCount = visits.filter((v) => v.status === "completed").length;

  const formattedDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Welcome & Overview Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Front Desk Overview
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {tenant?.name || "Clinic"} · {formattedDate}
          </p>
        </div>

        {/* Quick Actions Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Link href="/patients/new">
            <Button variant="primary" startIcon={<UserPlus className="w-4 h-4" />}>
              Register Patient
            </Button>
          </Link>
          <Link href="/queue">
            <Button variant="secondary" startIcon={<Clock className="w-4 h-4 text-[#1769E0]" />}>
              Live Queue
            </Button>
          </Link>
          <Link href="/calendar">
            <Button variant="secondary" startIcon={<Calendar className="w-4 h-4 text-[#1769E0]" />}>
              Calendar
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Row (TailAdmin Metric Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Waiting in Queue */}
        <Card className="hover:shadow-theme-sm transition-shadow">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Waiting Now
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
                {waitingCount}
              </p>
              <p className="text-xs text-amber-700 flex items-center gap-1 font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>Live queue arrivals</span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* In Consultation */}
        <Card className="hover:shadow-theme-sm transition-shadow">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                With Doctor
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
                {inConsultCount}
              </p>
              <p className="text-xs text-[#1769E0] flex items-center gap-1 font-medium">
                <Activity className="w-3.5 h-3.5" />
                <span>Active consultations</span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center shrink-0">
              <Activity className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Completed Today */}
        <Card className="hover:shadow-theme-sm transition-shadow">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Completed Visits
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
                {completedCount}
              </p>
              <p className="text-xs text-emerald-700 flex items-center gap-1 font-medium">
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Visits finalized today</span>
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        {/* Total Patients */}
        <Card className="hover:shadow-theme-sm transition-shadow">
          <CardContent className="p-5 flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Registered Patients
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
                {patientCount || 0}
              </p>
              <Link
                href="/patients"
                className="text-xs text-[#1769E0] hover:underline flex items-center gap-1 font-medium"
              >
                <span>View directory</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's Live Arrivals & Queue Overview */}
      <Card>
        <CardHeader
          action={
            <Link href="/queue">
              <Button variant="ghost" size="sm" endIcon={<ArrowRight className="w-4 h-4" />}>
                Full Queue View
              </Button>
            </Link>
          }
        >
          <CardTitle>Today&apos;s Active Patients</CardTitle>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            Real-time status of appointments and walk-in arrivals for today.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {visits.length === 0 ? (
            <div className="py-12">
              <EmptyState
                icon={<Clock className="w-6 h-6" />}
                title="No patients checked in today"
                description="Use Register Patient or Live Queue to begin checking in patients."
                action={
                  <div className="flex gap-2">
                    <Link href="/patients/new">
                      <Button variant="primary" size="sm">
                        Register Patient
                      </Button>
                    </Link>
                    <Link href="/queue">
                      <Button variant="secondary" size="sm">
                        Open Queue
                      </Button>
                    </Link>
                  </div>
                }
              />
            </div>
          ) : (
            <TableContainer className="border-0 rounded-none shadow-none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time / Type</TableHead>
                    <TableHead>Patient Details</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.slice(0, 8).map((v) => {
                    const visitTime = v.scheduled_at
                      ? new Date(v.scheduled_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        })
                      : new Date(v.created_at).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          hour12: true,
                        });
                    const patientInfo = (v as unknown as {
                      patients?: { full_name: string; phone: string };
                    }).patients;

                    return (
                      <TableRow key={v.id}>
                        <TableCell>
                          <div className="font-semibold text-gray-900 tabular-nums">
                            {visitTime}
                          </div>
                          <span className="text-xs uppercase text-gray-400 font-medium">
                            {v.origin_type === "walk_in" ? "Walk-In" : "Scheduled"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/patients/${v.patient_id}`}
                            className="font-medium text-gray-900 hover:text-[#1769E0]"
                          >
                            {patientInfo?.full_name || "Patient"}
                          </Link>
                          <div className="text-xs text-gray-500 tabular-nums">
                            {patientInfo?.phone || "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={v.status} />
                        </TableCell>
                        <TableCell className="text-end">
                          <Link href="/queue">
                            <Button variant="ghost" size="sm">
                              Manage
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
