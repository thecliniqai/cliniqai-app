import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { Button } from "@/components/ui/button";
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
            created_at: string;
          }> | null;
        }>;
      };
    };
  })
    .select("id, full_name, phone, abha_id, created_at")
    .eq("tenant_id", membership.tenantId)
    .order("created_at", { ascending: false });

  const patientList = patients || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Patients</h1>
          <p className="text-sm text-[#666] mt-1">
            Directory of registered clinic patients.
          </p>
        </div>
        <Link href="/patients/new">
          <Button variant="primary" className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            <span>Register Patient</span>
          </Button>
        </Link>
      </div>

      <div className="bg-white border border-[#E5E4E0] rounded-lg overflow-hidden">
        {patientList.length === 0 ? (
          <div className="p-12 text-center">
            <h3 className="text-base font-semibold text-[#1A1A1A]">No patients registered yet</h3>
            <p className="text-sm text-[#666] mt-1 mb-6">
              Get started by adding your first patient record.
            </p>
            <Link href="/patients/new">
              <Button variant="primary">Register Patient</Button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[#E5E4E0]">
            {patientList.map((p) => (
              <Link
                key={p.id}
                href={`/patients/${p.id}`}
                className="p-4 flex items-center justify-between hover:bg-[#FAF9F6] transition-colors block"
              >
                <div>
                  <div className="text-sm font-semibold text-[#1A1A1A]">{p.full_name}</div>
                  <div className="text-xs text-[#666] mt-0.5 flex items-center gap-2">
                    <span>{p.phone}</span>
                    {p.abha_id && (
                      <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[11px] font-medium">
                        ABHA: {p.abha_id}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-[#888]">
                  Registered {new Date(p.created_at).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
