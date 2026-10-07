import { notFound } from "next/navigation";
import Link from "next/link";
import { getPatient } from "@/features/patients/actions";
import { getCurrentConsent } from "@/features/patients/consent";
import { ConsentSection } from "./consent-section";
import { ArrowLeft, User, ShieldCheck } from "lucide-react";

export default async function PatientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  let patient;
  try {
    patient = await getPatient(id);
  } catch {
    notFound();
  }

  if (!patient) {
    notFound();
  }

  // Fetch current consent state for treatment and data sharing
  const treatmentConsent = await getCurrentConsent(patient.id, "treatment");
  const dataSharingConsent = await getCurrentConsent(patient.id, "data_sharing");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/patients"
          className="p-2 rounded-md hover:bg-white text-[#666] transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">
            {patient.full_name}
          </h1>
          <p className="text-sm text-[#666]">
            Patient Record ID: {patient.id.slice(0, 8)}...
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Demographic & Contact Details */}
        <div className="md:col-span-2 space-y-6">
          <section className="bg-white border border-[#E5E4E0] rounded-lg p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#1A1A1A] flex items-center gap-2">
              <User className="w-4 h-4 text-[#1769E0]" />
              Demographic Overview
            </h2>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs text-[#777] block">Phone Number</span>
                <span className="font-medium text-[#1A1A1A]">{patient.phone}</span>
              </div>
              <div>
                <span className="text-xs text-[#777] block">Sex / Gender</span>
                <span className="font-medium capitalize text-[#1A1A1A]">
                  {patient.sex || "Not recorded"}
                </span>
              </div>
              <div>
                <span className="text-xs text-[#777] block">Date of Birth</span>
                <span className="font-medium text-[#1A1A1A]">
                  {patient.date_of_birth || "Not recorded"}
                </span>
              </div>
              <div>
                <span className="text-xs text-[#777] block">ABHA Identity</span>
                {patient.abha_id ? (
                  <span className="font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-xs">
                    {patient.abha_id}
                  </span>
                ) : (
                  <span className="text-[#888] italic">Unlinked</span>
                )}
              </div>
            </div>

            {patient.address && (
              <div className="pt-3 border-t border-[#F0EFEA] text-sm">
                <span className="text-xs text-[#777] block">Registered Address</span>
                <span className="text-[#333]">
                  {Object.values(patient.address as Record<string, unknown>)
                    .filter(Boolean)
                    .map(String)
                    .join(", ")}
                </span>
              </div>
            )}
          </section>

          {/* Consent History & Controls */}
          <ConsentSection
            patientId={patient.id}
            treatmentConsent={treatmentConsent}
            dataSharingConsent={dataSharingConsent}
          />
        </div>

        {/* Quick Summary / Compliance status */}
        <div className="space-y-6">
          <section className="bg-white border border-[#E5E4E0] rounded-lg p-6 space-y-3">
            <h3 className="text-sm font-semibold text-[#1A1A1A] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Compliance Layer
            </h3>
            <p className="text-xs text-[#666]">
              All views and modifications to this patient record are cryptographically
              logged to the immutable tenant audit log.
            </p>
            <div className="pt-2 border-t border-[#F0EFEA] text-xs text-[#777]">
              Registered: {new Date(patient.created_at).toLocaleString()}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
