"use client";

import React, { useState, useEffect, useMemo, useTransition } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Vitals } from "@/features/consultation/schema";
import { recordVisitVitals } from "@/features/visits/actions";
import { Activity, Heart, Thermometer, Wind, Weight, Ruler, AlertCircle } from "lucide-react";

export interface TriageVitalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  visitId: string;
  patientName: string;
  tokenNumber?: number | null;
  existingVitals?: Vitals | null;
  onSuccess?: (updatedVitals: Vitals) => void;
}

export function TriageVitalsModal({
  isOpen,
  onClose,
  visitId,
  patientName,
  tokenNumber,
  existingVitals,
  onSuccess,
}: TriageVitalsModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [vitals, setVitals] = useState<Vitals>({
    systolic: null,
    diastolic: null,
    pulse: null,
    temperature: null,
    spo2: null,
    weight: null,
    height: null,
    respiratory_rate: null,
    bmi: null,
  });

  useEffect(() => {
    if (isOpen) {
      setError(null);
      if (existingVitals) {
        setVitals({
          systolic: existingVitals.systolic ?? null,
          diastolic: existingVitals.diastolic ?? null,
          pulse: existingVitals.pulse ?? null,
          temperature: existingVitals.temperature ?? null,
          spo2: existingVitals.spo2 ?? null,
          weight: existingVitals.weight ?? null,
          height: existingVitals.height ?? null,
          respiratory_rate: existingVitals.respiratory_rate ?? null,
          bmi: existingVitals.bmi ?? null,
        });
      } else {
        setVitals({
          systolic: null,
          diastolic: null,
          pulse: null,
          temperature: null,
          spo2: null,
          weight: null,
          height: null,
          respiratory_rate: null,
          bmi: null,
        });
      }
    }
  }, [isOpen, existingVitals]);

  // Auto-calculated BMI: Weight (kg) / [Height (m)]^2
  const bmiInfo = useMemo(() => {
    if (!vitals.weight || !vitals.height || vitals.height <= 0) return null;
    const heightInMeters = vitals.height / 100;
    const bmiVal = Number((vitals.weight / (heightInMeters * heightInMeters)).toFixed(1));

    if (bmiVal < 18.5) return { val: bmiVal, label: "Underweight", color: "warning" as const };
    if (bmiVal <= 24.9) return { val: bmiVal, label: "Normal", color: "success" as const };
    if (bmiVal <= 29.9) return { val: bmiVal, label: "Overweight", color: "warning" as const };
    return { val: bmiVal, label: "Obese", color: "error" as const };
  }, [vitals.weight, vitals.height]);

  // Clinical Abnormal Badges
  const bpBadge = useMemo(() => {
    if (!vitals.systolic && !vitals.diastolic) return null;
    if ((vitals.systolic && vitals.systolic >= 140) || (vitals.diastolic && vitals.diastolic >= 90)) {
      return { label: "High BP", color: "error" as const };
    }
    if ((vitals.systolic && vitals.systolic < 90) || (vitals.diastolic && vitals.diastolic < 60)) {
      return { label: "Low BP", color: "warning" as const };
    }
    return { label: "Normal BP", color: "success" as const };
  }, [vitals.systolic, vitals.diastolic]);

  const pulseBadge = useMemo(() => {
    if (!vitals.pulse) return null;
    if (vitals.pulse > 100) return { label: "Tachycardia", color: "warning" as const };
    if (vitals.pulse < 60) return { label: "Bradycardia", color: "warning" as const };
    return { label: "Normal Pulse", color: "success" as const };
  }, [vitals.pulse]);

  const spo2Badge = useMemo(() => {
    if (!vitals.spo2) return null;
    if (vitals.spo2 < 95) return { label: "Low Oxygen", color: "error" as const };
    return { label: "Normal SpO2", color: "success" as const };
  }, [vitals.spo2]);

  const tempBadge = useMemo(() => {
    if (!vitals.temperature) return null;
    if (vitals.temperature > 102.0) return { label: "High Fever", color: "error" as const };
    if (vitals.temperature > 99.5) return { label: "Fever", color: "warning" as const };
    return { label: "Normal Temp", color: "success" as const };
  }, [vitals.temperature]);

  const handleFieldChange = (field: keyof Vitals, val: string) => {
    const num = val === "" ? null : Number(val);
    const updated = { ...vitals, [field]: num };

    if (field === "weight" || field === "height") {
      const w = field === "weight" ? num : vitals.weight;
      const h = field === "height" ? num : vitals.height;
      if (w && h && h > 0) {
        const hm = h / 100;
        updated.bmi = Number((w / (hm * hm)).toFixed(1));
      } else {
        updated.bmi = null;
      }
    }

    setVitals(updated);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate BP relationship
    if (vitals.systolic != null && vitals.diastolic != null && vitals.systolic <= vitals.diastolic) {
      setError("Systolic BP must be strictly greater than diastolic BP.");
      return;
    }

    startTransition(async () => {
      const res = await recordVisitVitals(visitId, vitals);
      if (!res.success) {
        setError(res.error);
        return;
      }
      onSuccess?.(res.vitals);
      onClose();
    });
  };

  const titleText = tokenNumber
    ? `Triage Vitals · Token #${String(tokenNumber).padStart(2, "0")}`
    : "Triage Vitals";

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={titleText}
      description={`Record vital signs for ${patientName} before consultation.`}
      maxWidth="lg"
    >
      <form onSubmit={handleSave} className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Clinical Badges Row */}
        {(bpBadge || pulseBadge || tempBadge || spo2Badge || bmiInfo) && (
          <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-50 border border-gray-100 rounded-xl">
            {bpBadge && <Badge color={bpBadge.color}>{bpBadge.label}</Badge>}
            {pulseBadge && <Badge color={pulseBadge.color}>{pulseBadge.label}</Badge>}
            {tempBadge && <Badge color={tempBadge.color}>{tempBadge.label}</Badge>}
            {spo2Badge && <Badge color={spo2Badge.color}>{spo2Badge.label}</Badge>}
            {bmiInfo && (
              <Badge color={bmiInfo.color}>
                BMI: {bmiInfo.val} ({bmiInfo.label})
              </Badge>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Blood Pressure */}
          <div className="sm:col-span-2 grid grid-cols-2 gap-3 p-3.5 bg-gray-50/75 border border-gray-200 rounded-xl">
            <Field label="Systolic BP (mmHg)" htmlFor="systolic-bp-input" help="e.g. 120 (50 - 250)">
              <Input
                id="systolic-bp-input"
                type="number"
                min="50"
                max="250"
                step="1"
                placeholder="120"
                value={vitals.systolic ?? ""}
                onChange={(e) => handleFieldChange("systolic", e.target.value)}
              />
            </Field>

            <Field label="Diastolic BP (mmHg)" htmlFor="diastolic-bp-input" help="e.g. 80 (30 - 150)">
              <Input
                id="diastolic-bp-input"
                type="number"
                min="30"
                max="150"
                step="1"
                placeholder="80"
                value={vitals.diastolic ?? ""}
                onChange={(e) => handleFieldChange("diastolic", e.target.value)}
              />
            </Field>
          </div>

          {/* Pulse / Heart Rate */}
          <Field
            label="Pulse Rate (bpm)"
            htmlFor="pulse-rate-input"
            help="Normal: 60 - 100"
          >
            <div className="relative">
              <Input
                id="pulse-rate-input"
                type="number"
                min="30"
                max="220"
                step="1"
                placeholder="72"
                value={vitals.pulse ?? ""}
                onChange={(e) => handleFieldChange("pulse", e.target.value)}
              />
              <Heart className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>

          {/* Temperature */}
          <Field
            label="Body Temperature (°F)"
            htmlFor="temperature-input"
            help="Normal: 97.0 - 99.0"
          >
            <div className="relative">
              <Input
                id="temperature-input"
                type="number"
                min="90"
                max="110"
                step="0.1"
                placeholder="98.6"
                value={vitals.temperature ?? ""}
                onChange={(e) => handleFieldChange("temperature", e.target.value)}
              />
              <Thermometer className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>

          {/* SpO2 */}
          <Field
            label="SpO2 (%)"
            htmlFor="spo2-input"
            help="Normal: >= 95%"
          >
            <div className="relative">
              <Input
                id="spo2-input"
                type="number"
                min="50"
                max="100"
                step="1"
                placeholder="98"
                value={vitals.spo2 ?? ""}
                onChange={(e) => handleFieldChange("spo2", e.target.value)}
              />
              <Activity className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>

          {/* Respiratory Rate */}
          <Field
            label="Respiratory Rate (bpm)"
            htmlFor="respiratory-rate-input"
            help="Normal: 12 - 20"
          >
            <div className="relative">
              <Input
                id="respiratory-rate-input"
                type="number"
                min="8"
                max="60"
                step="1"
                placeholder="16"
                value={vitals.respiratory_rate ?? ""}
                onChange={(e) => handleFieldChange("respiratory_rate", e.target.value)}
              />
              <Wind className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>

          {/* Weight */}
          <Field
            label="Weight (kg)"
            htmlFor="weight-input"
            help="e.g. 68.5"
          >
            <div className="relative">
              <Input
                id="weight-input"
                type="number"
                min="0.5"
                max="300"
                step="0.1"
                placeholder="70"
                value={vitals.weight ?? ""}
                onChange={(e) => handleFieldChange("weight", e.target.value)}
              />
              <Weight className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>

          {/* Height */}
          <Field
            label="Height (cm)"
            htmlFor="height-input"
            help="e.g. 172"
          >
            <div className="relative">
              <Input
                id="height-input"
                type="number"
                min="20"
                max="250"
                step="0.5"
                placeholder="170"
                value={vitals.height ?? ""}
                onChange={(e) => handleFieldChange("height", e.target.value)}
              />
              <Ruler className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </Field>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={isPending}>
            Save Vitals
          </Button>
        </div>
      </form>
    </Modal>
  );
}
