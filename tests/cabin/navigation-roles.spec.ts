import { describe, it, expect } from "vitest";
import { clinicSettingsSchema } from "@/features/settings/schema";
import { CabinVisitItem } from "@/components/cabin/my-queue-card";

// Pure helper function mirroring AppSidebar role navigation logic
export function getNavForRole(role: string) {
  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const isDoctor = role === "doctor";

  const operationsNav = isDoctor
    ? [
        { label: "Doctor's Cabin", href: "/cabin" },
        { label: "Visits", href: "/visits" },
        { label: "My Calendar", href: "/calendar" },
        { label: "Patients", href: "/patients" },
      ]
    : [
        ...(isOwnerOrAdmin ? [{ label: "Doctor's Cabin", href: "/cabin" }] : []),
        { label: "Dashboard", href: "/" },
        { label: "Live Queue", href: "/queue" },
        { label: "Visits", href: "/visits" },
        { label: "Calendar", href: "/calendar" },
        { label: "Patients", href: "/patients" },
      ];

  const managementNav = isOwnerOrAdmin
    ? [
        { label: "Staff & Team", href: "/staff" },
        { label: "Clinic Profile", href: "/settings/clinic" },
        { label: "Billing & Reports", href: "/billing/reports" },
      ]
    : [];

  return { operationsNav, managementNav };
}

// Pure helper for segregating cabin visits
export function segregateCabinVisits(visits: CabinVisitItem[], targetDoctorId?: string) {
  const filtered = targetDoctorId && targetDoctorId !== "all"
    ? visits.filter((v) => v.doctor_id === targetDoctorId)
    : visits;

  const activeVisit = filtered.find((v) => v.status === "in_consultation") || null;
  const waitingVisits = filtered
    .filter((v) => v.status === "waiting")
    .sort((a, b) => {
      const tokenA = a.token_number ?? 999999;
      const tokenB = b.token_number ?? 999999;
      if (tokenA !== tokenB) return tokenA - tokenB;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const completedVisits = filtered
    .filter((v) => v.status === "completed")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return { activeVisit, waitingVisits, completedVisits };
}

describe("Role-Based Navigation & Cabin Permissions (REQ-multi-tenancy, REQ-diagnosis-visit-management)", () => {
  it("verifies owner has Doctor's Cabin, Operations, and Management menus", () => {
    const { operationsNav, managementNav } = getNavForRole("owner");
    const opHrefs = operationsNav.map((n) => n.href);
    const mgmtHrefs = managementNav.map((n) => n.href);

    expect(opHrefs).toContain("/cabin");
    expect(opHrefs).toContain("/");
    expect(opHrefs).toContain("/queue");
    expect(mgmtHrefs).toContain("/settings/clinic");
    expect(mgmtHrefs).toContain("/staff");
    expect(mgmtHrefs).toContain("/billing/reports");
  });

  it("verifies doctor role is focused strictly on clinical workspace", () => {
    const { operationsNav, managementNav } = getNavForRole("doctor");
    const opHrefs = operationsNav.map((n) => n.href);

    expect(opHrefs).toContain("/cabin");
    expect(opHrefs).toContain("/calendar");
    expect(opHrefs).toContain("/patients");

    // Doctor should NOT see front desk dashboard or management settings
    expect(opHrefs).not.toContain("/");
    expect(opHrefs).not.toContain("/queue");
    expect(managementNav).toHaveLength(0);
  });

  it("verifies receptionist and nurse see front desk operations without doctor cabin or management", () => {
    for (const role of ["receptionist", "nurse"]) {
      const { operationsNav, managementNav } = getNavForRole(role);
      const opHrefs = operationsNav.map((n) => n.href);

      expect(opHrefs).toContain("/");
      expect(opHrefs).toContain("/queue");
      expect(opHrefs).toContain("/calendar");
      expect(opHrefs).toContain("/patients");

      expect(opHrefs).not.toContain("/cabin");
      expect(managementNav).toHaveLength(0);
    }
  });

  it("correctly segregates visits into active in_consultation, waiting queue, and completed", () => {
    const mockVisits: CabinVisitItem[] = [
      {
        id: "v-1",
        doctor_id: "doc-1",
        patient_id: "p-1",
        status: "waiting",
        scheduled_at: null,
        created_at: "2026-10-15T09:00:00Z",
        reason_for_visit: "Cough",
        token_number: 2,
        priority: "normal",
        vitals: { bp_systolic: 120, bp_diastolic: 80 },
        patient: { id: "p-1", full_name: "John Doe", phone: "9876543210", sex: "male", age: 30, date_of_birth: null, uhid: "UHID-1" },
      },
      {
        id: "v-2",
        doctor_id: "doc-1",
        patient_id: "p-2",
        status: "in_consultation",
        scheduled_at: null,
        created_at: "2026-10-15T08:30:00Z",
        reason_for_visit: "Chest discomfort",
        token_number: 1,
        priority: "urgent",
        vitals: null,
        patient: { id: "p-2", full_name: "Jane Smith", phone: "9876543211", sex: "female", age: 45, date_of_birth: null, uhid: "UHID-2" },
      },
      {
        id: "v-3",
        doctor_id: "doc-2", // Assigned to different doctor
        patient_id: "p-3",
        status: "waiting",
        scheduled_at: null,
        created_at: "2026-10-15T09:15:00Z",
        reason_for_visit: "Routine checkup",
        token_number: 3,
        priority: "normal",
        vitals: null,
        patient: { id: "p-3", full_name: "Alice Brown", phone: "9876543212", sex: "female", age: 28, date_of_birth: null, uhid: "UHID-3" },
      },
      {
        id: "v-4",
        doctor_id: "doc-1",
        patient_id: "p-4",
        status: "completed",
        scheduled_at: null,
        created_at: "2026-10-15T08:00:00Z",
        reason_for_visit: "Follow-up",
        token_number: 0,
        vitals: null,
        patient: { id: "p-4", full_name: "Bob White", phone: "9876543213", sex: "male", age: 55, date_of_birth: null, uhid: "UHID-4" },
        prescription: { id: "rx-1", signed_at: "2026-10-15T08:25:00Z", pdf_storage_path: "/rx.pdf", status: "active" },
      },
    ];

    // Isolate Dr. 1
    const dr1Result = segregateCabinVisits(mockVisits, "doc-1");
    expect(dr1Result.activeVisit?.id).toBe("v-2");
    expect(dr1Result.activeVisit?.patient.full_name).toBe("Jane Smith");
    expect(dr1Result.waitingVisits).toHaveLength(1);
    expect(dr1Result.waitingVisits[0].id).toBe("v-1");
    expect(dr1Result.completedVisits).toHaveLength(1);
    expect(dr1Result.completedVisits[0].id).toBe("v-4");

    // Dr. 2 should only see their patient (v-3)
    const dr2Result = segregateCabinVisits(mockVisits, "doc-2");
    expect(dr2Result.activeVisit).toBeNull();
    expect(dr2Result.waitingVisits).toHaveLength(1);
    expect(dr2Result.waitingVisits[0].id).toBe("v-3");
    expect(dr2Result.completedVisits).toHaveLength(0);
  });

  it("validates clinic profile settings schema with practicing owner and OPD fees", () => {
    const validData = {
      name: "Sunrise Family Clinic",
      address: "123 Main Road, Pune",
      specialties: ["General Physician"],
      timezone: "Asia/Kolkata",
      owner_is_practicing_doctor: true,
      default_consultation_fee: 600,
      default_followup_fee: 350,
      accepted_payment_methods: ["cash", "upi"],
    };

    const parsed = clinicSettingsSchema.safeParse(validData);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.owner_is_practicing_doctor).toBe(true);
      expect(parsed.data.default_consultation_fee).toBe(600);
      expect(parsed.data.accepted_payment_methods).toEqual(["cash", "upi"]);
    }

    // Negative fee rejection
    const invalidFee = {
      ...validData,
      default_consultation_fee: -100,
    };
    expect(clinicSettingsSchema.safeParse(invalidFee).success).toBe(false);

    // Empty payment methods rejection
    const emptyMethods = {
      ...validData,
      accepted_payment_methods: [],
    };
    expect(clinicSettingsSchema.safeParse(emptyMethods).success).toBe(false);
  });
});
