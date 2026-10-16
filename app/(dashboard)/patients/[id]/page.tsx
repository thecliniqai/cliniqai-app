import { notFound } from "next/navigation";
import Link from "next/link";
import { getPatient, getPatientVisitHistory } from "@/features/patients/actions";
import { getCurrentConsent } from "@/features/patients/consent";
import { getActiveMembership } from "@/lib/auth/tenant";
import { ConsentSection } from "./consent-section";
import { PatientVisitHistory } from "@/components/patients/patient-visit-history";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  User,
  ShieldCheck,
  Calendar,
  Clock,
  Phone,
  MapPin,
  FileText,
} from "lucide-react";

export default async function PatientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  let patient;
  let visits = [];
  let userRole = "doctor";
  try {
    const [patientData, visitData, membership] = await Promise.all([
      getPatient(id),
      getPatientVisitHistory(id),
      getActiveMembership(),
    ]);
    patient = patientData;
    visits = visitData;
    userRole = membership.role;
  } catch {
    notFound();
  }

  if (!patient) {
    notFound();
  }

  // Fetch current consent state for treatment and data sharing
  const treatmentConsent = await getCurrentConsent(patient.id, "treatment");
  const dataSharingConsent = await getCurrentConsent(patient.id, "data_sharing");

  const initials = patient.full_name
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Top Navigation & Profile Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/patients">
            <Button variant="ghost" size="sm" startIcon={<ArrowLeft className="w-4 h-4" />}>
              Back
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center font-bold text-base shadow-theme-xs shrink-0">
              {initials}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
                  {patient.full_name}
                </h1>
                {patient.abha_id && (
                  <Badge color="success" size="sm">
                    ABHA Verified
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-500 font-mono mt-0.5">
                Record ID: {patient.id}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex items-center gap-2">
          <Link href={`/calendar?patientId=${patient.id}`}>
            <Button variant="secondary" size="sm" startIcon={<Calendar className="w-4 h-4 text-[#1769E0]" />}>
              Book Slot
            </Button>
          </Link>
          <Link href="/queue">
            <Button variant="primary" size="sm" startIcon={<Clock className="w-4 h-4" />}>
              Add to Queue
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Demographics & Contact */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-4 h-4 text-[#1769E0]" />
                <span>Demographic Details</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="p-3 rounded-lg bg-gray-50/70 space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-gray-400" />
                    Phone Number
                  </span>
                  <p className="font-semibold text-gray-900 tabular-nums">
                    {patient.phone}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-gray-50/70 space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    Sex / Gender
                  </span>
                  <p className="font-semibold text-gray-900 capitalize">
                    {patient.sex || "Not recorded"}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-gray-50/70 space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-gray-400" />
                    Date of Birth / Age
                  </span>
                  <p className="font-semibold text-gray-900 tabular-nums">
                    {patient.date_of_birth || "Unknown"}
                    {patient.age !== null && (
                      <span className="text-gray-500 font-normal"> ({patient.age} years)</span>
                    )}
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-gray-50/70 space-y-1">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    ABDM / ABHA ID
                  </span>
                  <p className="font-semibold text-gray-900 tabular-nums">
                    {patient.abha_id ? (
                      <span className="text-emerald-700 font-medium">
                        {patient.abha_id}
                      </span>
                    ) : (
                      <span className="text-gray-400 font-normal italic">
                        Not linked
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {patient.address && (
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-start gap-2 text-sm text-gray-700">
                  <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-xs text-gray-400 block font-medium">
                      Registered Address
                    </span>
                    <p className="mt-0.5">
                      {Object.values(patient.address as Record<string, unknown>)
                        .filter(Boolean)
                        .map(String)
                        .join(", ")}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Clinical Visit History Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#1769E0]" />
                <span>Clinical Visit History</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <PatientVisitHistory
                visits={visits}
                userRole={userRole}
                patientId={patient.id}
              />
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Consent, Security & Metadata */}
        <div className="space-y-6">
          {/* Consent Section */}
          <ConsentSection
            patientId={patient.id}
            treatmentConsent={treatmentConsent}
            dataSharingConsent={dataSharingConsent}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Security & Compliance</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-gray-500 leading-relaxed">
              <p>
                This record is protected by multi-tenant database Row Level Security.
                Every view and edit is logged to the immutable tenant audit log.
              </p>
              <div className="p-2.5 rounded-lg bg-gray-50 space-y-1 text-gray-600 font-mono text-[11px]">
                <div>Created: {new Date(patient.created_at).toLocaleDateString()}</div>
                <div>Status: Active Record</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
