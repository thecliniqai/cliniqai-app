"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { createClinic } from "@/features/clinics/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

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
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white p-6 rounded-[var(--radius-lg)] border border-[var(--border-default)] shadow-sm">
        <div className="mb-6">
          <span className="text-xs font-semibold text-[var(--brand-primary)] uppercase tracking-wider">
            Step 1 of 2
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] mt-1">
            Setup your clinic
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Let&apos;s start by naming your clinic tenant
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field
            label="Clinic Name"
            htmlFor="clinic-name"
            error={error || undefined}
            helpText="e.g. Apollo Family Health Clinic"
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

          <Button type="submit" loading={loading} className="w-full mt-2">
            Create Clinic
          </Button>
        </form>
      </div>
    </main>
  );
}
