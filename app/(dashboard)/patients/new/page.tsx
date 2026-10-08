"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createPatient } from "@/features/patients/actions";
import { findPotentialDuplicates, DuplicateMatch } from "@/features/patients/dedup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "@/components/ui/field";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { AgeDobInput } from "@/components/patients/age-dob-input";
import { DuplicateWarningBanner } from "@/components/patients/duplicate-warning-banner";
import { ArrowLeft, UserPlus, Shield, MapPin, User } from "lucide-react";
import Link from "next/link";

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
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <Link href="/patients">
          <Button variant="ghost" size="sm" startIcon={<ArrowLeft className="w-4 h-4" />}>
            Patients
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            Register New Patient
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Create an intake record with demographics, ABHA identity, and contact details.
          </p>
        </div>
      </div>

      {error && (
        <Alert type="error" title="Registration Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!dismissedDuplicates && duplicates.length > 0 && (
        <DuplicateWarningBanner
          matches={duplicates}
          onDismiss={() => setDismissedDuplicates(true)}
          onUseExisting={(id) => router.push(`/patients/${id}`)}
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Card 1: Basic Demographics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#1769E0]" />
              <span>Basic Demographics</span>
            </CardTitle>
            <p className="text-xs text-gray-500">
              Primary identification and contact info for the patient record.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
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
              label="Mobile Phone Number"
              htmlFor="phone"
              required
              helpText="10-digit primary contact number."
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

            <Field label="Sex / Gender" htmlFor="sex">
              <Select
                id="sex"
                value={formData.sex}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    sex: e.target.value as "male" | "female" | "other",
                  })
                }
              >
                <option value="">Select Sex</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Card 2: ABDM Health Identity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Ayushman Bharat Digital Mission (ABDM)</span>
            </CardTitle>
            <p className="text-xs text-gray-500">
              National Health ID linking (Optional for registration).
            </p>
          </CardHeader>
          <CardContent>
            <Field
              label="ABHA Number / Address"
              htmlFor="abha_id"
              helpText="Leave empty if patient has not created or linked their ABHA account yet."
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
          </CardContent>
        </Card>

        {/* Card 3: Address Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-500" />
              <span>Residential Address (Optional)</span>
            </CardTitle>
            <p className="text-xs text-gray-500">
              Locality and postal contact details.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Street / Flat / Locality" htmlFor="address_line1">
              <Input
                id="address_line1"
                value={formData.address.line1}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    address: { ...formData.address, line1: e.target.value },
                  })
                }
                placeholder="House No, Street, Ward / Area"
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="City / Town" htmlFor="city">
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
              <Field label="PIN Code" htmlFor="pincode">
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
          </CardContent>
          <CardFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.back()}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={loading}
              startIcon={<UserPlus className="w-4 h-4" />}
            >
              Save Patient Record
            </Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
