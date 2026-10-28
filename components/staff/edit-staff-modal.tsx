"use client";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStaffMember } from "@/features/settings/actions";
import { Membership, UserRole } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Field } from "@/components/ui/field";
import {
  X,
  User,
  Phone,
  Shield,
  GraduationCap,
  ShieldCheck,
  Stethoscope,
  AlertCircle,
  Save,
  Clock,
} from "lucide-react";
import { DoctorAvailabilityCard } from "@/components/profile/doctor-availability-card";

interface EditStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Membership;
}

export function EditStaffModal({ isOpen, onClose, member }: EditStaffModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(member.full_name || "");
  const [phone, setPhone] = useState(member.phone || "");
  const [role, setRole] = useState<UserRole>(member.role);
  const [medicalCouncilRegNo, setMedicalCouncilRegNo] = useState(
    member.medical_council_reg_no || ""
  );
  const [qualifications, setQualifications] = useState(member.qualifications || "");
  const [defaultSpecialty, setDefaultSpecialty] = useState(
    member.default_specialty || "general_physician"
  );
  const [activeTab, setActiveTab] = useState<"general" | "schedule">("general");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isDoctorOrOwner = role === "doctor" || role === "owner";

  const addDegreeChip = (deg: string) => {
    if (!qualifications.includes(deg)) {
      setQualifications((prev) => (prev ? `${prev}, ${deg}` : deg));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const res = await updateStaffMember({
        membership_id: member.id,
        full_name: fullName,
        phone: phone || null,
        role,
        medical_council_reg_no: isDoctorOrOwner ? medicalCouncilRegNo || null : null,
        qualifications: isDoctorOrOwner ? qualifications || null : null,
        default_specialty: defaultSpecialty,
      });

      if (res.success) {
        onClose();
        router.refresh();
      } else {
        setError(res.error || "Failed to update staff member.");
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className="bg-white w-full max-w-xl md:max-w-2xl rounded-2xl border border-gray-200 shadow-theme-lg overflow-hidden flex flex-col max-h-[92vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-staff-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gray-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#1769E0] flex items-center justify-center border border-blue-100">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 id="edit-staff-title" className="text-base font-bold text-gray-900">
                Edit Staff Member
              </h2>
              <p className="text-xs text-gray-500">
                Update staff role, contact details, and clinical credentials
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs for Doctors */}
        {isDoctorOrOwner && (
          <div className="flex border-b border-gray-100 bg-gray-50/50 px-5 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab("general")}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "general"
                  ? "border-[#1769E0] text-[#1769E0]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>General & Credentials</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("schedule")}
              className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeTab === "schedule"
                  ? "border-[#1769E0] text-[#1769E0]"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Working Hours & Schedule</span>
            </button>
          </div>
        )}

        {/* Form Body */}
        {activeTab === "schedule" ? (
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            <DoctorAvailabilityCard membership={member} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Full Name */}
            <Field label="Full Name" htmlFor="staff_fullname" required>
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <User className="w-4 h-4" />
                </span>
                <Input
                  id="staff_fullname"
                  type="text"
                  required
                  placeholder="e.g. Dr. Rajesh Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="ps-9 font-semibold text-xs"
                />
              </div>
            </Field>

            {/* Phone */}
            <Field label="Mobile / Contact" htmlFor="staff_phone">
              <PhoneInput
                id="staff_phone"
                value={phone}
                onChange={(digits) => setPhone(digits)}
                disabled={isPending}
              />
            </Field>

            {/* Role */}
            <Field label="Assigned Role" htmlFor="staff_role" required>
              <div className="relative">
                <span className="absolute start-3 top-2.5 text-gray-400">
                  <Shield className="w-4 h-4" />
                </span>
                <select
                  id="staff_role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full h-10 ps-9 pe-3 rounded-xl border border-gray-300 bg-white text-xs font-semibold text-gray-900 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                >
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </Field>

            {/* Default Specialty (if doctor) */}
            {isDoctorOrOwner && (
              <Field label="Primary Specialty" htmlFor="staff_specialty">
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400">
                    <Stethoscope className="w-4 h-4" />
                  </span>
                  <select
                    id="staff_specialty"
                    value={defaultSpecialty}
                    onChange={(e) => setDefaultSpecialty(e.target.value)}
                    className="w-full h-10 ps-9 pe-3 rounded-xl border border-gray-300 bg-white text-xs font-semibold text-gray-900 focus:outline-none focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0]"
                  >
                    <option value="general_physician">General Physician</option>
                    <option value="dental">Dental</option>
                    <option value="pediatrics">Pediatrics</option>
                  </select>
                </div>
              </Field>
            )}
          </div>

          {/* Clinical Credentials Section for Doctors */}
          {isDoctorOrOwner && (
            <div className="p-4 rounded-xl border border-blue-200 bg-[#F4F8FF]/80 space-y-3.5">
              <div className="flex items-center gap-2 pb-1.5 border-b border-blue-100">
                <GraduationCap className="w-4 h-4 text-[#1769E0]" />
                <h4 className="text-xs font-bold text-gray-900 uppercase tracking-wider">
                  Doctor Clinical Credentials
                </h4>
              </div>

              {/* Medical Council Reg No */}
              <Field
                label="Medical Council Registration No."
                htmlFor="staff_reg_no"
                help="Printed on prescriptions & receipts (e.g. KMC 48291 / MCI-2019-1234)"
                required
              >
                <div className="relative">
                  <span className="absolute start-3 top-2.5 text-gray-400">
                    <ShieldCheck className="w-4 h-4" />
                  </span>
                  <Input
                    id="staff_reg_no"
                    type="text"
                    required
                    placeholder="e.g. KMC 48291"
                    value={medicalCouncilRegNo}
                    onChange={(e) => setMedicalCouncilRegNo(e.target.value)}
                    className="ps-9 font-semibold uppercase text-xs"
                  />
                </div>
              </Field>

              {/* Qualifications */}
              <div className="space-y-1.5">
                <Field
                  label="Medical Degrees & Qualifications"
                  htmlFor="staff_qualifications"
                  required
                >
                  <Input
                    id="staff_qualifications"
                    type="text"
                    required
                    placeholder="e.g. MBBS, MD (Medicine), DNB"
                    value={qualifications}
                    onChange={(e) => setQualifications(e.target.value)}
                    className="text-xs font-medium"
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-gray-500 font-medium me-1">Quick Add:</span>
                  {["MBBS", "MD", "MS", "DNB", "BDS", "MDS", "DM", "MCh"].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => addDegreeChip(deg)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-blue-200 text-[#1769E0] hover:bg-blue-50 transition-colors cursor-pointer"
                    >
                      +{deg}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isPending}
              className="h-10 px-4 text-xs font-semibold rounded-xl border-gray-200 cursor-pointer"
            >
              Cancel
            </Button>

            <Button
              type="submit"
              disabled={isPending}
              className="h-10 px-5 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] text-xs font-semibold shadow-theme-xs cursor-pointer flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>{isPending ? "Saving..." : "Save Member Details"}</span>
            </Button>
          </div>
        </form>
      )}
      </div>
    </div>
  );
}
