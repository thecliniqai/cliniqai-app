import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/auth/tenant";
import { DoctorCabinView, DoctorOption } from "@/components/cabin/doctor-cabin-view";
import { CabinVisitItem } from "@/components/cabin/my-queue-card";

interface CabinPageProps {
  searchParams: Promise<{
    doctor?: string;
    date?: string;
  }>;
}

export default async function DoctorCabinPage(props: CabinPageProps) {
  const searchParams = await props.searchParams;
  const supabase = await createClient();

  let membership;
  try {
    membership = await getActiveMembership();
  } catch {
    redirect("/login");
  }

  // Non-clinical receptionist/nurse roles do not have a dedicated doctor's cabin
  if (membership.role === "receptionist" || membership.role === "nurse") {
    redirect("/queue");
  }

  const isOwnerOrAdmin = membership.role === "owner" || membership.role === "admin";
  const today = new Date().toISOString().split("T")[0];
  const currentDate = searchParams.date || today;

  // Fetch doctors and staff for the tenant
  const { data: memberRows } = await supabase
    .from("memberships")
    .select("id, user_id, role")
    .eq("tenant_id", membership.tenantId);

  interface MemberRow {
    id: string;
    user_id: string;
    role: string;
  }

  const allMembers = (memberRows as MemberRow[] | null) || [];
  // Doctors list: include doctors, plus owners/admins who can act as practicing doctors
  const doctors: DoctorOption[] = allMembers
    .filter((m) => m.role === "doctor" || m.role === "owner" || m.role === "admin")
    .map((m) => ({
      id: m.user_id,
      name:
        m.role === "doctor"
          ? `Dr. (${m.user_id.slice(0, 8)})`
          : `${m.role.toUpperCase()} (${m.user_id.slice(0, 8)})`,
      role: m.role,
    }));

  // Resolve target doctor
  let currentDoctorId = membership.userId;
  if (isOwnerOrAdmin && searchParams.doctor) {
    currentDoctorId = searchParams.doctor;
  }

  const startOfDay = `${currentDate}T00:00:00.000Z`;
  const endOfDay = `${currentDate}T23:59:59.999Z`;

  // Fetch visits for today
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let visitQuery = (supabase.from("visits") as any)
    .select(`
      id,
      tenant_id,
      patient_id,
      doctor_id,
      status,
      scheduled_at,
      created_at,
      reason_for_visit,
      vitals,
      chief_complaints,
      patient:patients (
        id,
        full_name,
        phone,
        sex,
        age,
        date_of_birth,
        uhid,
        allergies,
        chronic_conditions
      ),
      queue_token:queue_tokens (
        token_number,
        priority,
        called_at,
        completed_at
      ),
      prescription:prescriptions (
        id,
        status,
        signed_at,
        pdf_storage_path
      )
    `)
    .eq("tenant_id", membership.tenantId)
    .or(`scheduled_at.gte.${startOfDay},created_at.gte.${startOfDay}`)
    .or(`scheduled_at.lte.${endOfDay},created_at.lte.${endOfDay}`);

  if (currentDoctorId !== "all") {
    visitQuery = visitQuery.eq("doctor_id", currentDoctorId);
  }

  const { data: rawVisits, error: visitsError } = await visitQuery;

  if (visitsError) {
    console.error("[DoctorCabinPage] Error loading cabin visits:", visitsError);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: CabinVisitItem[] = ((rawVisits as any[]) || []).map((row) => {
    const queueToken = Array.isArray(row.queue_token) ? row.queue_token[0] : row.queue_token;
    const prescription = Array.isArray(row.prescription) ? row.prescription[0] : row.prescription;
    const patientRaw = Array.isArray(row.patient) ? row.patient[0] : row.patient;

    return {
      id: row.id,
      doctor_id: row.doctor_id,
      patient_id: row.patient_id,
      status: row.status,
      scheduled_at: row.scheduled_at,
      created_at: row.created_at,
      reason_for_visit: row.reason_for_visit,
      token_number: queueToken?.token_number ?? null,
      priority: queueToken?.priority ?? "normal",
      vitals: row.vitals || null,
      patient: {
        id: patientRaw?.id || row.patient_id,
        full_name: patientRaw?.full_name || "Unknown Patient",
        phone: patientRaw?.phone || "",
        sex: patientRaw?.sex || null,
        age: patientRaw?.age != null ? patientRaw.age : null,
        date_of_birth: patientRaw?.date_of_birth || null,
        uhid: patientRaw?.uhid || null,
        allergies: patientRaw?.allergies || [],
        chronic_conditions: patientRaw?.chronic_conditions || [],
      },
      prescription: prescription
        ? {
            id: prescription.id,
            signed_at: prescription.signed_at,
            pdf_storage_path: prescription.pdf_storage_path,
            status: prescription.status,
          }
        : null,
    };
  });

  // Segregate visits into Active, Waiting, and Completed
  const activeVisit = items.find((v) => v.status === "in_consultation") || null;
  const waitingVisits = items
    .filter((v) => v.status === "waiting")
    .sort((a, b) => {
      const tokenA = a.token_number ?? 999999;
      const tokenB = b.token_number ?? 999999;
      if (tokenA !== tokenB) return tokenA - tokenB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const completedVisits = items
    .filter((v) => v.status === "completed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const currentDoctorName =
    doctors.find((d) => d.id === currentDoctorId)?.name ||
    `Doctor (${currentDoctorId.slice(0, 8)})`;

  return (
    <div className="max-w-6xl mx-auto py-2">
      <DoctorCabinView
        activeVisit={activeVisit}
        waitingVisits={waitingVisits}
        completedVisits={completedVisits}
        currentDoctorId={currentDoctorId}
        doctorName={currentDoctorName}
        doctors={doctors}
        isOwnerOrAdmin={isOwnerOrAdmin}
        currentDate={currentDate}
      />
    </div>
  );
}
