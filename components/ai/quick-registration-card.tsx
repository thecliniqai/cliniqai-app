"use client";

import React, { useState } from "react";
import { User, Loader2 } from "lucide-react";
import { PhoneInput } from "@/components/ui/phone-input";
import { createPatient } from "@/features/patients/actions";
import { cn } from "@/lib/utils";

export interface QuickRegistrationCardProps {
  initialName?: string;
  initialPhone?: string;
  onRegistered: (patient: { id: string; full_name: string; phone: string }) => void;
  onCancel?: () => void;
  className?: string;
}

export function QuickRegistrationCard({
  initialName = "",
  initialPhone = "",
  onRegistered,
  onCancel,
  className,
}: QuickRegistrationCardProps) {
  const [fullName, setFullName] = useState(initialName);
  const [phoneDigits, setPhoneDigits] = useState(initialPhone.replace(/\D/g, "").slice(0, 10));
  const [phoneE164, setPhoneE164] = useState(
    initialPhone.startsWith("+91") ? initialPhone : `+91${phoneDigits}`
  );
  const [gender, setGender] = useState<string>("male");
  const [age, setAge] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!fullName.trim()) {
      setErrorMsg("Patient full name is required.");
      return;
    }

    if (phoneDigits.length !== 10) {
      setErrorMsg("Valid 10-digit Indian mobile number is required.");
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const res = await createPatient({
        full_name: fullName.trim(),
        phone: phoneE164,
        sex: gender as "male" | "female" | "other",
        age: age ? parseInt(age, 10) : null,
        date_of_birth: null,
        abha_id: null,
      });

      if (!res.success) {
        setErrorMsg(res.error || "Failed to create patient.");
        setIsLoading(false);
        return;
      }

      onRegistered({
        id: res.patientId,
        full_name: fullName.trim(),
        phone: phoneE164,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || "Registration failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className={cn(
        "w-full rounded-xl border border-[#E4E5E7] bg-white p-4 shadow-sm my-2",
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-[#F1F2F4] pb-2 mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#17181A]">
          <User className="w-3.5 h-3.5 text-[#1769E0]" />
          <span>Quick Patient Registration</span>
        </div>
        <span className="text-[11px] text-gray-500 font-medium">New Patient</span>
      </div>

      {errorMsg && (
        <div className="mb-3 text-xs text-[#B42318] bg-[#FDECEA] p-2 rounded border border-[#F2B8B5]">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
            Full Name *
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ramesh Kumar"
            className="w-full h-10 px-3 rounded-lg border border-[#E4E5E7] bg-white text-xs text-[#17181A] placeholder:text-gray-400 focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-gray-700 mb-1">
            Indian Mobile Number *
          </label>
          <PhoneInput
            value={phoneDigits}
            onChange={(digits, e164) => {
              setPhoneDigits(digits);
              setPhoneE164(e164);
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Gender
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full h-10 px-2.5 rounded-lg border border-[#E4E5E7] bg-white text-xs text-[#17181A] focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none cursor-pointer"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">
              Age (Years)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="e.g. 35"
              className="w-full h-10 px-3 rounded-lg border border-[#E4E5E7] bg-white text-xs text-[#17181A] placeholder:text-gray-400 focus:border-[#1769E0] focus:ring-1 focus:ring-[#1769E0] outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-[#F1F2F4]">
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 h-9 px-3 rounded-lg bg-[#1769E0] hover:bg-[#0F5AB8] text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Registering...</span>
              </>
            ) : (
              "Register & Book Patient"
            )}
          </button>

          {onCancel && (
            <button
              type="button"
              disabled={isLoading}
              onClick={onCancel}
              className="h-9 px-3 rounded-lg border border-[#C9CCD1] bg-white text-xs font-medium text-[#52565B] hover:bg-gray-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
