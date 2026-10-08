import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  TableContainer,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { UserPlus, Users, ArrowUpRight, ShieldCheck, User } from "lucide-react";

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

      {/* Patients Data Table Card */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="w-4 h-4 text-[#1769E0]" />
            <span>Patient Records</span>
          </CardTitle>
          <span className="text-xs text-gray-400">
            Showing all active patient records
          </span>
        </CardHeader>

        <CardContent className="p-0">
          {patientList.length === 0 ? (
            <div className="py-14">
              <EmptyState
                icon={<User className="w-6 h-6" />}
                title="No patients registered yet"
                description="Get started by creating your clinic's first patient intake record."
                action={
                  <Link href="/patients/new">
                    <Button variant="primary" size="sm" startIcon={<UserPlus className="w-4 h-4" />}>
                      Register Patient
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <TableContainer className="border-0 rounded-none shadow-none">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Age / Sex</TableHead>
                    <TableHead>National Health ID</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead className="text-end">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patientList.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link
                          href={`/patients/${p.id}`}
                          className="font-semibold text-gray-900 hover:text-[#1769E0] transition-colors flex items-center gap-2 group"
                        >
                          <span>{p.full_name}</span>
                          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 text-[#1769E0] transition-opacity" />
                        </Link>
                        <span className="text-xs text-gray-400 font-mono">
                          ID: {p.id.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium text-gray-700 tabular-nums">
                          {p.phone}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-600">
                          {p.age !== null ? `${p.age} yrs` : "—"}
                          {p.sex && ` · `}
                          <span className="capitalize">{p.sex || ""}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {p.abha_id ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <ShieldCheck className="w-3 h-3" />
                            <span>{p.abha_id}</span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Unlinked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-500 tabular-nums">
                          {new Date(p.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </TableCell>
                      <TableCell className="text-end">
                        <Link href={`/patients/${p.id}`}>
                          <Button variant="ghost" size="sm">
                            View Profile
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
