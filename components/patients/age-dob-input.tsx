"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { calculateAgeFromDob, calculateDobFromAge } from "@/features/patients/schema";

export interface AgeDobInputProps {
  dobValue?: string | null;
  ageValue?: number | null;
  onDobChange?: (dob: string | null) => void;
  onAgeChange?: (age: number | null) => void;
  error?: string;
  disabled?: boolean;
}

export function AgeDobInput({
  dobValue,
  ageValue,
  onDobChange,
  onAgeChange,
  error,
  disabled = false,
}: AgeDobInputProps) {
  const [internalDob, setInternalDob] = useState<string>(dobValue || "");
  const [internalAge, setInternalAge] = useState<string>(
    ageValue !== null && ageValue !== undefined ? String(ageValue) : ""
  );

  // Sync when external props change
  useEffect(() => {
    if (dobValue !== undefined) {
      setInternalDob(dobValue || "");
    }
  }, [dobValue]);

  useEffect(() => {
    if (ageValue !== undefined) {
      setInternalAge(ageValue !== null ? String(ageValue) : "");
    }
  }, [ageValue]);

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDob = e.target.value;
    setInternalDob(newDob);
    onDobChange?.(newDob ? newDob : null);

    if (newDob) {
      const derivedAge = calculateAgeFromDob(newDob);
      if (derivedAge !== null) {
        setInternalAge(String(derivedAge));
        onAgeChange?.(derivedAge);
      }
    } else {
      onDobChange?.(null);
    }
  };

  const handleAgeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setInternalAge(rawVal);

    if (rawVal === "") {
      onAgeChange?.(null);
      return;
    }

    const num = parseInt(rawVal, 10);
    if (!isNaN(num) && num >= 0 && num <= 130) {
      onAgeChange?.(num);
      const derivedDob = calculateDobFromAge(num);
      setInternalDob(derivedDob);
      onDobChange?.(derivedDob);
    }
  };

  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="patient-dob" className="text-sm font-medium text-gray-700">
            Date of Birth
          </label>
          <Input
            id="patient-dob"
            name="date_of_birth"
            type="date"
            value={internalDob}
            onChange={handleDobChange}
            disabled={disabled}
            invalid={!!error}
            max={new Date().toISOString().split("T")[0]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="patient-age" className="text-sm font-medium text-gray-700">
            Age (Years)
          </label>
          <Input
            id="patient-age"
            name="age"
            type="number"
            min={0}
            max={130}
            placeholder="e.g. 42"
            value={internalAge}
            onChange={handleAgeChange}
            disabled={disabled}
            invalid={!!error}
          />
        </div>
      </div>
      {error && (
        <p className="text-xs text-[#B42318] font-medium mt-0.5">
          {error}
        </p>
      )}
    </div>
  );
}
