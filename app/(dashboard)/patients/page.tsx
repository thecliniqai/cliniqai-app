import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PatientDirectoryTable } from "@/components/patients/patient-directory-table";
import { UserPlus } from "lucide-react";

export default async function PatientsPage() {
  const supabase = await createClient();
  const membership = await getActiveMembership();

  const { data: patients } = await (supabase.from("patients") as unknown as {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        order: (col: string, opts: { ascending: boolean }) => Promise<{
          data: Array<{
            id: string;
            full_name: string;
            phone: string;
            abha_id: string | null;
            age: number | null;
            sex: string | null;
            created_at: string;
          }> | null;
        }>;
      };
    };
  })
    .select("id, full_name, phone, abha_id, age, sex, created_at")
    .eq("tenant_id", membership.tenantId)
    .order("created_at", { ascending: false });

  const patientList = patients || [];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              Patients
            </h1>
            <Badge color="primary" size="sm">
              {patientList.length} Registered
            </Badge>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Complete clinic patient directory and demographic records.
          </p>
        </div>

        <Link href="/patients/new">
          <Button variant="primary" startIcon={<UserPlus className="w-4 h-4" />}>
            Register Patient
          </Button>
        </Link>
      </div>

      {/* Interactive Patients Directory Table with Live Search */}
      <PatientDirectoryTable initialPatients={patientList} />
    </div>
  );
}
