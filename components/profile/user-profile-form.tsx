"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Membership } from "@/lib/db/types";
import { updateUserProfile } from "@/features/settings/actions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { DoctorAvailabilityCard } from "@/components/profile/doctor-availability-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Phone,
  Mail,
  Building2,
  GraduationCap,
  ShieldCheck,
  Stethoscope,
  Save,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface UserProfileFormProps {
  user: {
    id: string;
    email: string;
    fullName: string;
    phone: string;
  };
  membership: Membership;
  clinicName: string;
}

export function UserProfileForm({ user, membership, clinicName }: UserProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(membership.full_name || user.fullName || "");
  const [phone, setPhone] = useState(membership.phone || user.phone || "");
  const [medicalCouncilRegNo, setMedicalCouncilRegNo] = useState(
    membership.medical_council_reg_no || ""
  );
  const [qualifications, setQualifications] = useState(membership.qualifications || "");
  const [defaultSpecialty, setDefaultSpecialty] = useState(
    membership.default_specialty || "general_physician"
  );

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isDoctorOrOwner = membership.role === "doctor" || membership.role === "owner";

  const addDegreeChip = (deg: string) => {
    if (!qualifications.includes(deg)) {
      setQualifications((prev) => (prev ? `${prev}, ${deg}` : deg));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    startTransition(async () => {
      const res = await updateUserProfile({
        full_name: fullName,
        phone: phone || null,
        medical_council_reg_no: isDoctorOrOwner ? medicalCouncilRegNo || null : null,
        qualifications: isDoctorOrOwner ? qualifications || null : null,
        default_specialty: defaultSpecialty,
      });

      if (res.success) {
        setStatusMessage({
          type: "success",
          text: "Your profile and credentials have been updated successfully.",
        });
        router.refresh();
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to update profile.",
        });
      }
    });
  };

  const getRoleBadge = (role: string) => {
    switch (role.toLowerCase()) {
      case "owner":
        return <Badge color="primary" size="sm">Owner</Badge>;
      case "doctor":
        return <Badge color="info" size="sm">Doctor</Badge>;
      case "admin":
        return <Badge color="primary" size="sm">Admin</Badge>;
      case "nurse":
        return <Badge color="success" size="sm">Nurse</Badge>;
      case "receptionist":
        return <Badge color="warning" size="sm">Receptionist</Badge>;
      default:
        return <Badge color="gray" size="sm" className="capitalize">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
      {statusMessage && (
        <div
          className={`p-4 rounded-xl flex items-center gap-2.5 text-sm font-medium border ${
            statusMessage.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* Card 1: User Identity & Account Context */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-[#1769E0] border border-blue-100">
                <User className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Account &amp; Personal Info</CardTitle>
                <CardDescription>
                  Your profile identity across clinic encounters and communication
                </CardDescription>
              </div>
            </div>
            <div>{getRoleBadge(membership.role)}</div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Full Name */}
            <Field label="Full Name" htmlFor="profile_full_name" required>
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <User className="w-4 h-4" />
                </span>
                <Input
                  id="profile_full_name"
                  type="text"
                  required
                  placeholder="e.g. Dr. Rajesh Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="ps-9 font-semibold"
                />
              </div>
            </Field>

            {/* Mobile / Contact Number */}
            <Field label="Mobile / Contact Number" htmlFor="profile_phone">
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <Phone className="w-4 h-4" />
                </span>
                <Input
                  id="profile_phone"
                  type="tel"
                  placeholder="e.g. +91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="ps-9"
                />
              </div>
            </Field>

            {/* Email Address (Read-only) */}
            <Field label="Login Email" htmlFor="profile_email">
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <Mail className="w-4 h-4" />
                </span>
                <Input
                  id="profile_email"
                  type="email"
                  disabled
                  value={user.email}
                  className="ps-9 bg-gray-50 text-gray-500 cursor-not-allowed"
                />
              </div>
            </Field>

            {/* Active Clinic (Read-only) */}
            <Field label="Active Clinic / Practice" htmlFor="profile_clinic">
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <Building2 className="w-4 h-4" />
                </span>
                <Input
                  id="profile_clinic"
                  type="text"
                  disabled
                  value={clinicName}
                  className="ps-9 bg-gray-50 text-gray-500 cursor-not-allowed font-medium"
                />
              </div>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Doctor Clinical Credentials (If Doctor or Owner) */}
      {isDoctorOrOwner && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600 border border-emerald-100">
                <GraduationCap className="w-4 h-4" />
              </div>
              <div>
                <CardTitle>Medical Credentials &amp; Prescription Profile</CardTitle>
                <CardDescription>
                  Printed on signed prescriptions (Rx), discharge notes, and consultation receipts
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Medical Council Reg No */}
              <Field
                label="Medical Council Registration No."
                htmlFor="profile_reg_no"
                help="e.g. KMC 48291 / MCI-2018-0912 (Mandatory under NMC guidelines)"
                required
              >
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                  <Input
                    id="profile_reg_no"
                    type="text"
                    required
                    placeholder="e.g. KMC 48291"
                    value={medicalCouncilRegNo}
                    onChange={(e) => setMedicalCouncilRegNo(e.target.value)}
                    className="ps-9 font-semibold uppercase"
                  />
                </div>
              </Field>

              {/* Default Specialty */}
              <Field label="Primary Clinical Specialty" htmlFor="profile_specialty">
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400">
                    <Stethoscope className="w-4 h-4" />
                  </span>
                  <select
                    id="profile_specialty"
                    value={defaultSpecialty}
                    onChange={(e) => setDefaultSpecialty(e.target.value)}
                    className="w-full h-10 ps-9 pe-3 rounded-xl border border-gray-300 bg-white text-sm font-medium text-gray-900 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                  >
                    <option value="general_physician">General Physician</option>
                    <option value="dental">Dental</option>
                    <option value="pediatrics">Pediatrics</option>
                  </select>
                </div>
              </Field>
            </div>

            {/* Medical Degrees / Qualifications */}
            <div className="space-y-2">
              <Field
                label="Degrees &amp; Medical Qualifications"
                htmlFor="profile_qualifications"
                help="Displayed beside your name on prescription headers."
                required
              >
                <Input
                  id="profile_qualifications"
                  type="text"
                  required
                  placeholder="e.g. MBBS, MD (General Medicine), DNB"
                  value={qualifications}
                  onChange={(e) => setQualifications(e.target.value)}
                  className="font-medium"
                />
              </Field>

              {/* Quick Add Chips */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-gray-500 font-medium me-1">Quick Add:</span>
                {["MBBS", "MD", "MS", "DNB", "BDS", "MDS", "DM", "MCh", "DCH", "DGO"].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => addDegreeChip(deg)}
                    className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white border border-blue-200 text-[#1769E0] hover:bg-blue-50 transition-colors cursor-pointer"
                  >
                    +{deg}
                  </button>
                ))}
              </div>
            </div>

            {/* Prescription Preview Banner */}
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-start gap-3 text-xs text-gray-600">
              <Stethoscope className="w-4 h-4 text-[#1769E0] shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-gray-800 block">
                  How this appears on patient documents:
                </span>
                <span className="text-gray-900 font-medium">
                  {fullName ? fullName : "Dr. [Your Name]"}
                  {qualifications ? `, ${qualifications}` : ""}
                </span>
                {medicalCouncilRegNo && (
                  <span className="text-gray-500 block">
                    Reg No: {medicalCouncilRegNo}
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          disabled={isPending}
          className="h-11 px-6 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-sm shadow-theme-xs cursor-pointer flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          <span>{isPending ? "Saving Profile..." : "Save Profile Settings"}</span>
        </Button>
      </div>
    </form>

    {isDoctorOrOwner && (
      <div className="pt-2">
        <DoctorAvailabilityCard membership={membership} />
      </div>
    )}
  </div>
  );
}
