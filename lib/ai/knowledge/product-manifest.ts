export interface ProductFeatureEntry {
  id: string;
  title: string;
  navigation_path: string;
  summary: string;
  navigation_steps: string[];
  supported_features: string[];
  unsupported_features: string[];
  keywords: string[];
}

export const PRODUCT_MANIFEST: Record<string, ProductFeatureEntry> = {
  appointments_calendar: {
    id: "appointments_calendar",
    title: "Appointments & Calendar",
    navigation_path: "/calendar",
    summary:
      "Manage doctor schedules, slot availability, weekly split shifts, and book/reschedule outpatient consultations.",
    navigation_steps: [
      "Navigate to Calendar from the sidebar (/calendar)",
      "Select target Doctor and Date from the header controls",
      "Click any available time slot on the calendar grid to initiate booking",
      "Fill patient details or search existing patient and confirm booking",
    ],
    supported_features: [
      "Weekly shifts and split shift configurations",
      "Interactive appointment booking and slot blocking",
      "Rescheduling with conflict detection",
      "Cancellations with atomic slot release",
      "Soft blocks and emergency consultation squeeze-ins",
    ],
    unsupported_features: [
      "Automated overbooking without staff confirmation",
      "In-patient bed management",
      "External non-clinic calendar sync (Google/Outlook 2-way sync)",
    ],
    keywords: [
      "calendar",
      "appointment",
      "booking",
      "schedule",
      "reschedule",
      "cancel",
      "slot",
      "shift",
      "timing",
    ],
  },
  opd_queue: {
    id: "opd_queue",
    title: "OPD Token Queue & Triage",
    navigation_path: "/queue",
    summary:
      "Live outpatient token management, triage vital signs recording, queue state transitions, and billing handoff.",
    navigation_steps: [
      "Navigate to Live Queue from the sidebar (/queue)",
      "View live token tabs: Waiting, With Doctor, Billing, Completed",
      "Click 'Call Token' or 'Start Consultation' to advance patient into doctor cabin",
      "Record preliminary vitals (BP, Pulse, SpO2, Temp, Weight) from the queue action menu",
    ],
    supported_features: [
      "Sequential token number allocation and call displays",
      "Queue state transitions: waiting -> with_doctor -> billing -> completed",
      "Triage vitals capture by front-desk or nursing staff",
      "Walk-in patient quick check-in",
    ],
    unsupported_features: [
      "Automated token skipping without human action",
      "Hospital emergency department triage scoring (ESI/CTAS)",
    ],
    keywords: [
      "queue",
      "token",
      "waiting",
      "triage",
      "vitals",
      "walk-in",
      "check-in",
      "turn",
    ],
  },
  doctor_cabin: {
    id: "doctor_cabin",
    title: "Doctor Cabin & Electronic Health Record (EHR)",
    navigation_path: "/cabin",
    summary:
      "Doctor consultation workspace for shorthand SOAP note creation, ICD-10 diagnosis ranking, prescription builder, and signed PDF generation.",
    navigation_steps: [
      "Navigate to Doctor Cabin from the sidebar (/cabin)",
      "Select active patient from the in-consultation banner",
      "Enter clinical shorthand in the SOAP workspace or use Clinical Copilot",
      "Search and add ICD-10 diagnostic codes and prescribed medications",
      "Sign off consultation to generate final PDF and release visit to billing",
    ],
    supported_features: [
      "SOAP clinical note sections (Chief Complaints, Exam, Advice)",
      "AI Quick Scribe shorthand-to-SOAP generation with granular section insertion",
      "Curated OPD ICD-10 code search with differential criteria bullets",
      "Prescription builder with frequency chips (OD, BD, TDS) and duration helpers",
      "Historical medication chips and favorite templates",
      "Server-side clean prescription PDF generation without AI watermarks",
    ],
    unsupported_features: [
      "Autonomous AI prescribing without doctor sign-off",
      "Automated drug-drug interaction alerts (deferred per Clinician Control Rule)",
      "Ambient microphone audio transcription",
    ],
    keywords: [
      "cabin",
      "consultation",
      "soap",
      "notes",
      "prescription",
      "rx",
      "diagnosis",
      "icd",
      "icd-10",
      "exam",
      "doctor",
    ],
  },
  patient_directory: {
    id: "patient_directory",
    title: "Patient Directory & Records",
    navigation_path: "/patients",
    summary:
      "Comprehensive patient registry with flexible 10-digit mobile search, E.164 validation, deduplication, and visit timeline.",
    navigation_steps: [
      "Navigate to Patients from the sidebar (/patients)",
      "Use search bar to search by name or 10-digit Indian mobile number",
      "Click patient row to view longitudinal visit timeline, past prescriptions, and vitals",
      "Click 'Register Patient' to add a new patient with mandatory Indian mobile format",
    ],
    supported_features: [
      "Strict 10-digit Indian mobile validation (/^[6-9]\\d{9}$/) and E.164 storage (+91...)",
      "Duplicate phone number warning and disambiguation",
      "Chronological visit history and past prescription downloads",
      "Patient profile edit and demographic tracking",
    ],
    unsupported_features: [
      "Self-service patient web portal registration",
      "Direct facial recognition patient check-in",
    ],
    keywords: [
      "patient",
      "patients",
      "directory",
      "registration",
      "register",
      "phone",
      "mobile",
      "history",
      "timeline",
    ],
  },
  billing_invoices: {
    id: "billing_invoices",
    title: "Billing & Payments",
    navigation_path: "/billing",
    summary:
      "Outpatient billing, consultation fee collection, procedure line items, and payment mode recording (Cash, UPI, Card).",
    navigation_steps: [
      "Navigate to Billing (/billing) or Queue billing tab (/queue?tab=billing)",
      "Select completed patient visit to review charges",
      "Add procedure or medicine fees if applicable",
      "Select payment mode (Cash, UPI, Card) and mark invoice as Paid",
      "Optionally send consolidated digital receipt via WhatsApp",
    ],
    supported_features: [
      "Consultation fee and itemized charge tally",
      "Multiple payment mode recording: Cash, UPI, Card, Net Banking",
      "Receipt generation and invoice status tracking",
      "Consolidated WhatsApp receipt dispatch",
    ],
    unsupported_features: [
      "Cryptocurrency payments",
      "Automated third-party insurance TPA cashless claim pre-authorization",
      "Inpatient ward bed charge reconciliation",
    ],
    keywords: [
      "billing",
      "payment",
      "invoice",
      "fee",
      "charge",
      "upi",
      "cash",
      "receipt",
    ],
  },
  settings_shifts: {
    id: "settings_shifts",
    title: "Settings & Staff Roster",
    navigation_path: "/settings",
    summary:
      "Clinic administration, staff invitations, role-based access control, and doctor shift roster configuration.",
    navigation_steps: [
      "Navigate to Settings or Profile from sidebar (/settings)",
      "Manage clinic details, operating hours, and consultation default fees",
      "Configure doctor shift hours, slot durations, and break windows",
      "Invite staff members and assign roles (Doctor, Nurse, Receptionist, Admin)",
    ],
    supported_features: [
      "Doctor weekly shift intervals and break configuration",
      "Staff user management with RBAC roles",
      "Clinic details, address, and letterhead stationery settings",
    ],
    unsupported_features: [
      "Multi-hospital group centralized payroll processing",
      "Biometric hardware attendance terminal synchronization",
    ],
    keywords: [
      "settings",
      "profile",
      "shift",
      "staff",
      "roles",
      "permissions",
      "roster",
      "timing",
    ],
  },
};

export interface ProductHelpResult {
  topic: string;
  found: boolean;
  summary: string;
  navigation_steps: string[];
  supported_features: string[];
  unsupported_features: string[];
}

/**
 * Retrieves verified, grounded ClinicOS product guidance and navigation steps.
 * Explicitly rejects unsupported features to prevent LLM hallucinations.
 */
export function getProductHelpAnswer(queryTopic: string): ProductHelpResult {
  const normalized = (queryTopic || "").toLowerCase().trim();

  // Explicit check for unsupported / hallucination-prone topics
  const unsupportedChecks = [
    {
      terms: ["crypto", "bitcoin", "ethereum"],
      reason: "Cryptocurrency payments are not supported. ClinicOS supports Cash, UPI, Card, and Net Banking.",
    },
    {
      terms: ["in-patient", "ipd", "bed allocation", "ward management"],
      reason: "In-patient ward bed management is not supported. ClinicOS is designed exclusively for Outpatient Department (OPD) clinic workflows.",
    },
    {
      terms: ["autonomous prescribing", "auto prescribe", "auto dosage"],
      reason: "Autonomous prescribing is strictly prohibited per National Medical Commission (NMC) regulations. All prescriptions require explicit Registered Medical Practitioner (doctor) review and sign-off.",
    },
    {
      terms: ["robotic surgery", "tele-surgery", "surgery robotics"],
      reason: "Surgical robotics or tele-surgery controls are not supported.",
    },
  ];

  for (const check of unsupportedChecks) {
    if (check.terms.some((term) => normalized.includes(term))) {
      return {
        topic: queryTopic,
        found: false,
        summary: `Unsupported feature: ${check.reason}`,
        navigation_steps: [],
        supported_features: [],
        unsupported_features: [check.reason],
      };
    }
  }

  // Exact ID match
  if (PRODUCT_MANIFEST[normalized]) {
    const entry = PRODUCT_MANIFEST[normalized];
    return {
      topic: entry.title,
      found: true,
      summary: entry.summary,
      navigation_steps: entry.navigation_steps,
      supported_features: entry.supported_features,
      unsupported_features: entry.unsupported_features,
    };
  }

  // Keyword match
  for (const entry of Object.values(PRODUCT_MANIFEST)) {
    if (
      entry.keywords.some((kw) => normalized.includes(kw)) ||
      entry.title.toLowerCase().includes(normalized) ||
      entry.summary.toLowerCase().includes(normalized)
    ) {
      return {
        topic: entry.title,
        found: true,
        summary: entry.summary,
        navigation_steps: entry.navigation_steps,
        supported_features: entry.supported_features,
        unsupported_features: entry.unsupported_features,
      };
    }
  }

  // Fallback if not found
  return {
    topic: queryTopic,
    found: false,
    summary:
      "Topic not found in verified ClinicOS product manual. Available areas include Calendar, OPD Queue, Doctor Cabin, Patient Directory, Billing, and Settings.",
    navigation_steps: [
      "Access the main sidebar menu to navigate through Calendar, Queue, Patients, Cabin, Billing, and Settings.",
    ],
    supported_features: Object.values(PRODUCT_MANIFEST).map((m) => m.title),
    unsupported_features: [
      "Third-party external modifications",
      "Unverified automated workflows",
    ],
  };
}
