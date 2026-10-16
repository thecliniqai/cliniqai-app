"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Pencil,
  Phone,
  User,
  ShieldCheck,
  MapPin,
  HeartPulse,
  AlertCircle,
  FileText,
  Shield,
  Activity,
  CreditCard,
  PlusCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Patient } from "@/lib/db/types";
import { PatientVisitHistoryItem } from "@/features/patients/schema";
import { CurrentConsentState } from "@/features/patients/consent";
import { PatientVisitHistory } from "./patient-visit-history";
import { EditPatientModal } from "./edit-patient-modal";
import { ConsentSection } from "@/app/(dashboard)/patients/[id]/consent-section";
import { cn } from "@/lib/utils";

interface PatientDetailViewProps {
  patient: Patient;
  visits: PatientVisitHistoryItem[];
  userRole: string;
  treatmentConsent: CurrentConsentState;
  dataSharingConsent: CurrentConsentState;
}

export function PatientDetailView({
  patient: initialPatient,
  visits,
  userRole,
  treatmentConsent,
  dataSharingConsent,
}: PatientDetailViewProps) {
  const [patient, setPatient] = useState<Patient>(initialPatient);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"visits" | "profile" | "consent">("visits");

  const initials = patient.full_name
    .split(" ")
    .filter(Boolean)
    .map((n: string) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const addressObj = (patient.address as Record<string, string>) || {};
  const formattedAddress = [
    addressObj.line1,
    addressObj.city,
    addressObj.state,
    addressObj.pincode,
  ]
    .filter(Boolean)
    .join(", ");

  const emergencyObj = (patient.emergency_contact as Record<string, string>) || {};
  const hasEmergency = emergencyObj.name || emergencyObj.phone;

  return (
    <div className="w-full space-y-6">
      {/* Top Patient Hero Identity Card */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-xs p-5 sm:p-6 space-y-5">
        {/* Header Action Bar & Avatar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-100">
          <div className="flex items-start sm:items-center gap-4">
            <Link href="/patients">
              <Button
                variant="ghost"
                size="sm"
                startIcon={<ArrowLeft className="w-4 h-4" />}
                className="h-9 px-2.5 text-gray-600 hover:text-gray-900"
              >
                Patients
              </Button>
            </Link>

            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 rounded-2xl bg-[#EAF2FF] text-[#1769E0] flex items-center justify-center font-bold text-lg shadow-theme-xs shrink-0 border border-[#1769E0]/15">
                {initials || "PT"}
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
                    {patient.full_name}
                  </h1>

                  {patient.abha_id ? (
                    <Badge color="success" size="sm" startIcon={<ShieldCheck className="w-3.5 h-3.5" />}>
                      ABHA: {patient.abha_id}
                    </Badge>
                  ) : (
                    <Badge color="gray" size="sm">
                      No ABHA Linked
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                  <span className="font-mono text-gray-400">ID: {patient.id.slice(0, 13)}...</span>
                  <span>•</span>
                  <span>Registered: {new Date(patient.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons: Edit Details, Book Slot, Add to Queue */}
          <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-center">
            <Button
              variant="secondary"
              size="sm"
              startIcon={<Pencil className="w-3.5 h-3.5 text-gray-600" />}
              onClick={() => setIsEditModalOpen(true)}
              className="h-9 font-medium"
            >
              Edit Details
            </Button>

            <Link href={`/calendar?patientId=${patient.id}`}>
              <Button
                variant="secondary"
                size="sm"
                startIcon={<Calendar className="w-3.5 h-3.5 text-[#1769E0]" />}
                className="h-9 font-medium"
              >
                Book Slot
              </Button>
            </Link>

            <Link href="/queue">
              <Button
                variant="primary"
                size="sm"
                startIcon={<Clock className="w-3.5 h-3.5" />}
                className="h-9 font-medium"
              >
                Add to Queue
              </Button>
            </Link>
          </div>
        </div>

        {/* Quick Glance Info Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-gray-50/80 border border-gray-100 space-y-0.5">
            <span className="text-[11px] text-gray-500 flex items-center gap-1 font-medium">
              <Phone className="w-3.5 h-3.5 text-gray-400" />
              Phone Number
            </span>
            <p className="font-semibold text-gray-900 font-mono text-sm pt-0.5">
              {patient.phone || "Not recorded"}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50/80 border border-gray-100 space-y-0.5">
            <span className="text-[11px] text-gray-500 flex items-center gap-1 font-medium">
              <User className="w-3.5 h-3.5 text-gray-400" />
              Sex & Age
            </span>
            <p className="font-semibold text-gray-900 capitalize text-sm pt-0.5">
              {patient.sex || "Unknown"}{" "}
              {patient.age !== null && (
                <span className="text-gray-500 font-normal">({patient.age} yrs)</span>
              )}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50/80 border border-gray-100 space-y-0.5">
            <span className="text-[11px] text-gray-500 flex items-center gap-1 font-medium">
              <HeartPulse className="w-3.5 h-3.5 text-rose-500" />
              Allergies
            </span>
            <p className="font-semibold text-gray-900 text-sm pt-0.5 truncate">
              {patient.allergies && patient.allergies.length > 0 ? (
                <span className="text-rose-700">{patient.allergies.join(", ")}</span>
              ) : (
                <span className="text-gray-400 font-normal italic">None recorded</span>
              )}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-gray-50/80 border border-gray-100 space-y-0.5">
            <span className="text-[11px] text-gray-500 flex items-center gap-1 font-medium">
              <MapPin className="w-3.5 h-3.5 text-gray-400" />
              Location / City
            </span>
            <p className="font-semibold text-gray-900 text-sm pt-0.5 truncate">
              {addressObj.city || addressObj.line1 ? (
                [addressObj.city, addressObj.state].filter(Boolean).join(", ")
              ) : (
                <span className="text-gray-400 font-normal italic">Not recorded</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Main Tabbed Navigation Bar */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-6" aria-label="Patient Tabs">
          <button
            type="button"
            onClick={() => setActiveTab("visits")}
            className={cn(
              "py-3 px-1 border-b-2 text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer",
              activeTab === "visits"
                ? "border-[#1769E0] text-[#1769E0]"
                : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            )}
          >
            <FileText className="w-4 h-4" />
            <span>Clinical Encounters</span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-bold",
                activeTab === "visits"
                  ? "bg-blue-50 text-[#1769E0]"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {visits.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={cn(
              "py-3 px-1 border-b-2 text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer",
              activeTab === "profile"
                ? "border-[#1769E0] text-[#1769E0]"
                : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            )}
          >
            <User className="w-4 h-4" />
            <span>Demographics & Contact</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("consent")}
            className={cn(
              "py-3 px-1 border-b-2 text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer",
              activeTab === "consent"
                ? "border-[#1769E0] text-[#1769E0]"
                : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            )}
          >
            <Shield className="w-4 h-4" />
            <span>Consent & Privacy</span>
          </button>
        </nav>
      </div>

      {/* Tab 1: Clinical Visit History (Full Width) */}
      {activeTab === "visits" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#1769E0]" />
                  <span>Clinical Visit History</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Chronological record of consultations, diagnoses, prescriptions, and billing.
                </p>
              </div>

              <Link href={`/calendar?patientId=${patient.id}`}>
                <Button variant="outline" size="sm" startIcon={<Calendar className="w-3.5 h-3.5" />}>
                  Schedule Visit
                </Button>
              </Link>
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
      )}

      {/* Tab 2: Demographics & Profile (Full Width) */}
      {activeTab === "profile" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4 text-[#1769E0]" />
                  <span>Comprehensive Demographics</span>
                </CardTitle>
                <p className="text-xs text-gray-500 mt-0.5">
                  Complete intake details, contact information, and medical background.
                </p>
              </div>

              <Button
                variant="primary"
                size="sm"
                startIcon={<Pencil className="w-3.5 h-3.5" />}
                onClick={() => setIsEditModalOpen(true)}
              >
                Edit Details
              </Button>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* Primary Personal Info */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
                  Personal Information
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">Full Name</span>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5">{patient.full_name}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">Phone Number</span>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5 font-mono">{patient.phone}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">Sex / Gender</span>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5 capitalize">
                      {patient.sex || "Not recorded"}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">Date of Birth & Age</span>
                    <p className="font-semibold text-gray-900 text-sm mt-0.5">
                      {patient.date_of_birth || "Unknown"}
                      {patient.age !== null && (
                        <span className="text-gray-500 font-normal"> ({patient.age} years)</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* ABDM & Identifiers */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Health Identifiers (ABDM)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">ABHA Number / Address</span>
                    <p className="font-semibold text-emerald-800 text-sm mt-0.5 font-mono">
                      {patient.abha_id ? patient.abha_id : "Not linked to ABHA"}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100">
                    <span className="text-[11px] text-gray-500 block">Internal Record ID (UHID)</span>
                    <p className="font-mono text-gray-700 text-xs mt-0.5">{patient.id}</p>
                  </div>
                </div>
              </div>

              {/* Medical Background: Allergies & Chronic Conditions */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
                  <HeartPulse className="w-3.5 h-3.5 text-rose-600" />
                  Medical Background
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                    <span className="text-[11px] text-gray-500 font-medium block">Known Allergies</span>
                    {patient.allergies && patient.allergies.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {patient.allergies.map((allergy, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-md bg-rose-50 text-rose-800 border border-rose-200 font-medium text-xs"
                          >
                            {allergy}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">No allergies recorded.</p>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 space-y-1.5">
                    <span className="text-[11px] text-gray-500 font-medium block">Chronic Conditions</span>
                    {patient.chronic_conditions && patient.chronic_conditions.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {patient.chronic_conditions.map((cond, i) => (
                          <span
                            key={i}
                            className="px-2.5 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200 font-medium text-xs"
                          >
                            {cond}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">No chronic conditions recorded.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Residential Address */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-gray-500" />
                  Residential Address
                </h3>
                <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 text-xs">
                  {formattedAddress ? (
                    <p className="text-gray-900 font-medium leading-relaxed">{formattedAddress}</p>
                  ) : (
                    <p className="text-gray-400 italic">No residential address recorded.</p>
                  )}
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="pt-4 border-t border-gray-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-amber-600" />
                  Emergency Contact
                </h3>
                <div className="p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 text-xs">
                  {hasEmergency ? (
                    <p className="text-gray-900 font-medium">
                      {emergencyObj.name}{" "}
                      {emergencyObj.relation && (
                        <span className="text-gray-500">({emergencyObj.relation})</span>
                      )}
                      {emergencyObj.phone && (
                        <span className="font-mono text-gray-700 ml-2">• {emergencyObj.phone}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-gray-400 italic">No emergency contact provided.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 3: Consent & Privacy (Full Width) */}
      {activeTab === "consent" && (
        <div className="space-y-6">
          <ConsentSection
            patientId={patient.id}
            treatmentConsent={treatmentConsent}
            dataSharingConsent={dataSharingConsent}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-600" />
                <span>Security & Multi-Tenant Audit Compliance</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs text-gray-500 leading-relaxed">
              <p>
                This clinical record is cryptographically scoped to your clinic tenant and enforced by
                PostgreSQL Row Level Security (RLS). Every access, edit, and prescription generation is
                logged into the immutable compliance audit log.
              </p>
              <div className="p-3 rounded-xl bg-gray-50 space-y-1 text-gray-700 font-mono text-[11px] border border-gray-100">
                <div>Patient Record ID: {patient.id}</div>
                <div>Tenant ID: {patient.tenant_id}</div>
                <div>Created At: {new Date(patient.created_at).toLocaleString("en-IN")}</div>
                <div>Last Modified: {new Date(patient.updated_at || patient.created_at).toLocaleString("en-IN")}</div>
                <div>Status: Active Verified Clinic Record</div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Edit Patient Demographics Modal */}
      <EditPatientModal
        patient={patient}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={(updated) => setPatient(updated)}
      />
    </div>
  );
}
