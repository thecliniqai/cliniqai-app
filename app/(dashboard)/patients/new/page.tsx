"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createPatient } from "@/features/patients/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export default function NewPatientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    date_of_birth: "",
    sex: "" as "male" | "female" | "other" | "",
    abha_id: "",
    address: {
      line1: "",
      city: "",
      state: "",
      pincode: "",
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldErrors({});

    const result = await createPatient({
      full_name: formData.full_name,
      phone: formData.phone,
      date_of_birth: formData.date_of_birth || null,
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
        <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">
          Register New Patient
        </h1>
        <p className="text-sm text-[#666] mt-1">
          Add demographic and contact records. ABHA number is optional.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md"
        >
          {error}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-[#E5E4E0] rounded-lg p-6 space-y-6"
      >
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-[#1A1A1A]">Basic Details</h2>

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
              onChange={(e) =>
                setFormData({ ...formData, full_name: e.target.value })
              }
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
              onChange={(e) =>
                setFormData({ ...formData, phone: e.target.value })
              }
              placeholder="9876543210"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date of Birth" htmlFor="date_of_birth">
              <Input
                id="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={(e) =>
                  setFormData({ ...formData, date_of_birth: e.target.value })
                }
              />
            </Field>

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
                className="w-full h-11 px-3 rounded-md border border-[#D1D0CB] bg-white text-sm text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#1769E0]"
              >
                <option value="">Select Sex</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>
        </div>

        <div className="pt-4 border-t border-[#E5E4E0] space-y-4">
          <h2 className="text-base font-semibold text-[#1A1A1A]">
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

        <div className="pt-4 border-t border-[#E5E4E0] space-y-4">
          <h2 className="text-base font-semibold text-[#1A1A1A]">
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
          <div className="grid grid-cols-3 gap-3">
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
