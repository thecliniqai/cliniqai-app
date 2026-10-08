"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClinic } from "@/features/clinics/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Building2, ArrowRight } from "lucide-react";

export default function NewClinicPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData();
    formData.append("name", name);

    const res = await createClinic(formData);

    if (!res.success) {
      setError(res.error);
      setLoading(false);
      return;
    }

    router.push("/");
  };

  return (
    <main className="min-h-screen bg-gray-50/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-8 sm:p-10 rounded-2xl border border-gray-200 shadow-theme-sm">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-12 h-12 rounded-2xl bg-brand-500 text-white flex items-center justify-center mb-4 shadow-theme-xs">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-50 text-brand-700 border border-brand-200 mb-2">
            Step 1 of 2
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Setup your clinic
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 max-w-xs">
            Name your clinic workspace to initialize your patient roster
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field
            label="Clinic Name"
            htmlFor="clinic-name"
            error={error || undefined}
            help="e.g. Apollo Family Health Clinic"
            required
          >
            <Input
              id="clinic-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter clinic name"
              required
              autoFocus
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="w-full h-11 text-sm font-semibold gap-2 shadow-theme-xs"
          >
            <span>Create Clinic</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-100 text-center">
          <p className="text-xs text-gray-400">
            You will be assigned as the founding Clinic Owner
          </p>
        </div>
      </div>
    </main>
  );
}

