"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createPatient } from "@/features/patients/actions";
import { findPotentialDuplicates, DuplicateMatch } from "@/features/patients/dedup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { DuplicateWarningBanner } from "@/components/patients/duplicate-warning-banner";

export default function NewPatientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    date_of_birth: "",
    age: null as number | null,
    sex: "" as "male" | "female" | "other" | "",
    abha_id: "",
    address: {
      line1: "",
      city: "",
      state: "",
      pincode: "",
    },
  });

  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [dismissedDuplicates, setDismissedDuplicates] = useState(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced duplicate lookup
  useEffect(() => {
    if (dismissedDuplicates) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const hasSearchableInput =
      formData.phone.trim().length >= 8 || formData.full_name.trim().length >= 3;

    if (!hasSearchableInput) {
      setDuplicates([]);
      return;
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const matches = await findPotentialDuplicates({
          phone: formData.phone,
          fullName: formData.full_name,
          age: formData.age,
          dob: formData.date_of_birth || null,
        });
        setDuplicates(matches);
      } catch (err) {
        console.error("Duplicate check failed:", err);
      }
    }, 400);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [formData.phone, formData.full_name, formData.age, formData.date_of_birth, dismissedDuplicates]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await createPatient({
      full_name: formData.full_name,
      phone: formData.phone,
      date_of_birth: formData.date_of_birth || null,
      age: formData.age,
      sex: formData.sex ? formData.sex : null,
      abha_id: formData.abha_id.trim() !== "" ? formData.abha_id : null,
      address:
        formData.address.line1 || formData.address.city
          ? formData.address
          : null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error);
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
      }
      return;
    }

    router.push(`/patients/${result.patientId}`);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          Register New Patient
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Add demographic and contact records. ABHA number is optional.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-[var(--status-error-bg)] border border-[var(--status-error-border)] text-[var(--status-error)] text-sm rounded-[var(--radius-md)]"
        >
          {error}
        </div>
      )}

      {!dismissedDuplicates && duplicates.length > 0 && (
        <DuplicateWarningBanner
          matches={duplicates}
          onDismiss={() => setDismissedDuplicates(true)}
          onUseExisting={(id) => router.push(`/patients/${id}`)}
        />
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[var(--border-default)] rounded-[var(--radius-lg)] p-6 space-y-6"
      >
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Basic Details</h2>

          <Field
            label="Patient Full Name"
            htmlFor="full_name"
            required
            error={fieldErrors.full_name?.[0]}
          >
            <Input
              id="full_name"
              required
              value={formData.full_name}
              onChange={(e) => {
                setDismissedDuplicates(false);
                setFormData({ ...formData, full_name: e.target.value });
              }}
              placeholder="e.g. Ramesh Kumar"
            />
          </Field>

          <Field
            label="Phone Number"
            htmlFor="phone"
            required
            help="10-digit mobile number."
            error={fieldErrors.phone?.[0]}
          >
            <Input
              id="phone"
              type="tel"
              required
              value={formData.phone}
              onChange={(e) => {
                setDismissedDuplicates(false);
                setFormData({ ...formData, phone: e.target.value });
              }}
              placeholder="9876543210"
            />
          </Field>

          {/* Bidirectional Age and DOB Input */}
          <AgeDobInput
            dobValue={formData.date_of_birth}
            ageValue={formData.age}
            onDobChange={(dob) => {
              setDismissedDuplicates(false);
              setFormData((prev) => ({ ...prev, date_of_birth: dob || "" }));
            }}
            onAgeChange={(age) => {
              setDismissedDuplicates(false);
              setFormData((prev) => ({ ...prev, age }));
            }}
            error={fieldErrors.date_of_birth?.[0] || fieldErrors.age?.[0]}
            disabled={loading}
          />

          <Field label="Sex" htmlFor="sex">
            <select
              id="sex"
              value={formData.sex}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sex: e.target.value as "male" | "female" | "other",
                })
              }
              className="w-full min-h-[44px] px-3 py-2 text-base rounded-[var(--radius-md)] border border-[var(--border-default)] bg-white text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)] transition-colors"
            >
              <option value="">Select Sex</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <div className="pt-4 border-t border-[var(--border-subtle)] space-y-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            National Health Identity (ABDM)
          </h2>
          <Field
            label="ABHA Number / Address"
            htmlFor="abha_id"
            help="Optional. Leave blank if patient has not linked their ABHA yet."
            error={fieldErrors.abha_id?.[0]}
          >
            <Input
              id="abha_id"
              value={formData.abha_id}
              onChange={(e) =>
                setFormData({ ...formData, abha_id: e.target.value })
              }
              placeholder="e.g. 14-digit ABHA or abha@abdm"
            />
          </Field>
        </div>

        <div className="pt-4 border-t border-[var(--border-subtle)] space-y-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Address Information (Optional)
          </h2>
          <Field label="Street Address" htmlFor="address_line1">
            <Input
              id="address_line1"
              value={formData.address.line1}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  address: { ...formData.address, line1: e.target.value },
                })
              }
              placeholder="House/Street/Area"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="City" htmlFor="city">
              <Input
                id="city"
                value={formData.address.city}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    address: { ...formData.address, city: e.target.value },
                  })
                }
                placeholder="City"
              />
            </Field>
            <Field label="State" htmlFor="state">
              <Input
                id="state"
                value={formData.address.state}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    address: { ...formData.address, state: e.target.value },
                  })
                }
                placeholder="State"
              />
            </Field>
            <Field label="Pincode" htmlFor="pincode">
              <Input
                id="pincode"
                value={formData.address.pincode}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    address: { ...formData.address, pincode: e.target.value },
                  })
                }
                placeholder="PIN"
              />
            </Field>
          </div>
        </div>

        <div className="pt-4 flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? "Registering..." : "Save Patient"}
          </Button>
        </div>
      </form>
    </div>
  );
}
