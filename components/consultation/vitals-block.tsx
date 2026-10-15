"use client";

import React, { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, Heart, Thermometer, Wind, Weight, Ruler, Edit2, Check } from "lucide-react";
import { Vitals } from "@/features/consultation/schema";

export interface VitalsBlockProps {
  vitals: Vitals;
  onChange: (updated: Vitals) => void;
  recordedBy?: string | null;
  recordedAt?: string | null;
  disabled?: boolean;
}

export function VitalsBlock({
  vitals,
  onChange,
  recordedBy,
  recordedAt,
  disabled = false,
}: VitalsBlockProps) {
  const [isEditing, setIsEditing] = useState(false);

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
    return { label: "Normal", color: "success" as const };
  }, [vitals.systolic, vitals.diastolic]);

  const pulseBadge = useMemo(() => {
    if (!vitals.pulse) return null;
    if (vitals.pulse > 100) return { label: "Tachycardia", color: "warning" as const };
    if (vitals.pulse < 60) return { label: "Bradycardia", color: "warning" as const };
    return { label: "Normal", color: "success" as const };
  }, [vitals.pulse]);

  const spo2Badge = useMemo(() => {
    if (!vitals.spo2) return null;
    if (vitals.spo2 < 95) return { label: "Low Oxygen", color: "error" as const };
    return { label: "Normal", color: "success" as const };
  }, [vitals.spo2]);

  const tempBadge = useMemo(() => {
    if (!vitals.temperature) return null;
    if (vitals.temperature > 102.0) return { label: "High Fever", color: "error" as const };
    if (vitals.temperature > 99.5) return { label: "Fever", color: "warning" as const };
    return { label: "Normal", color: "success" as const };
  }, [vitals.temperature]);

  const handleFieldChange = (field: keyof Vitals, val: string) => {
    const num = val === "" ? null : Number(val);
    const updated = { ...vitals, [field]: num };

    // Update calculated BMI
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

    onChange(updated);
  };

  const hasAnyVitals =
    vitals.systolic ||
    vitals.diastolic ||
    vitals.pulse ||
    vitals.temperature ||
    vitals.spo2 ||
    vitals.weight ||
    vitals.height;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4 mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#1769E0]" />
            Vital Signs
          </h3>
          {(recordedBy || recordedAt) && (
            <p className="text-xs text-gray-500 mt-0.5">
              Recorded by {recordedBy || "Staff"}{" "}
              {recordedAt ? `at ${new Date(recordedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          )}
        </div>

        {!disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            aria-label="Edit vitals"
            className="text-xs text-[#1769E0] hover:text-[#1455B3] gap-1.5"
          >
            {isEditing ? (
              <>
                <Check className="w-4 h-4" /> Done
              </>
            ) : (
              <>
                <Edit2 className="w-4 h-4" /> {hasAnyVitals ? "Edit Vitals" : "Record Vitals"}
              </>
            )}
          </Button>
        )}
      </div>

      {isEditing ? (
        /* Edit Mode: Clean Form Inputs */
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          {/* BP */}
          <div className="space-y-1 col-span-2 sm:col-span-2">
            <label className="text-xs font-medium text-gray-700">Blood Pressure (mmHg)</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Sys"
                value={vitals.systolic ?? ""}
                onChange={(e) => handleFieldChange("systolic", e.target.value)}
                className="h-10 text-sm"
                min={50}
                max={250}
              />
              <span className="text-gray-400 font-medium">/</span>
              <Input
                type="number"
                placeholder="Dia"
                value={vitals.diastolic ?? ""}
                onChange={(e) => handleFieldChange("diastolic", e.target.value)}
                className="h-10 text-sm"
                min={30}
                max={150}
              />
            </div>
            {vitals.systolic && vitals.diastolic && vitals.systolic <= vitals.diastolic && (
              <p className="text-[11px] text-rose-600 font-medium">Sys must be &gt; Dia</p>
            )}
          </div>

          {/* Pulse */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Pulse (bpm)</label>
            <Input
              type="number"
              placeholder="72"
              value={vitals.pulse ?? ""}
              onChange={(e) => handleFieldChange("pulse", e.target.value)}
              className="h-10 text-sm"
              min={30}
              max={220}
            />
          </div>

          {/* SpO2 */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">SpO2 (%)</label>
            <Input
              type="number"
              placeholder="98"
              value={vitals.spo2 ?? ""}
              onChange={(e) => handleFieldChange("spo2", e.target.value)}
              className="h-10 text-sm"
              min={50}
              max={100}
            />
          </div>

          {/* Temperature */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Temp (°F)</label>
            <Input
              type="number"
              step="0.1"
              placeholder="98.6"
              value={vitals.temperature ?? ""}
              onChange={(e) => handleFieldChange("temperature", e.target.value)}
              className="h-10 text-sm"
              min={90}
              max={110}
            />
          </div>

          {/* Weight */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Weight (kg)</label>
            <Input
              type="number"
              step="0.1"
              placeholder="70"
              value={vitals.weight ?? ""}
              onChange={(e) => handleFieldChange("weight", e.target.value)}
              className="h-10 text-sm"
              min={0.5}
              max={300}
            />
          </div>

          {/* Height */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-700">Height (cm)</label>
            <Input
              type="number"
              placeholder="170"
              value={vitals.height ?? ""}
              onChange={(e) => handleFieldChange("height", e.target.value)}
              className="h-10 text-sm"
              min={20}
              max={250}
            />
          </div>
        </div>
      ) : (
        /* Read / Dashboard Summary Cards */
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* BP */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Heart className="w-3.5 h-3.5 text-rose-500" /> BP
              </span>
              {bpBadge && <Badge color={bpBadge.color} size="sm">{bpBadge.label}</Badge>}
            </div>
            <div className="text-base font-semibold text-gray-900">
              {vitals.systolic && vitals.diastolic ? (
                <span>
                  {vitals.systolic}/{vitals.diastolic} <span className="text-xs text-gray-500 font-normal">mmHg</span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>

          {/* Pulse */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Activity className="w-3.5 h-3.5 text-[#1769E0]" /> Pulse
              </span>
              {pulseBadge && <Badge color={pulseBadge.color} size="sm">{pulseBadge.label}</Badge>}
            </div>
            <div className="text-base font-semibold text-gray-900">
              {vitals.pulse ? (
                <span>
                  {vitals.pulse} <span className="text-xs text-gray-500 font-normal">bpm</span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>

          {/* SpO2 */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Wind className="w-3.5 h-3.5 text-sky-500" /> SpO2
              </span>
              {spo2Badge && <Badge color={spo2Badge.color} size="sm">{spo2Badge.label}</Badge>}
            </div>
            <div className="text-base font-semibold text-gray-900">
              {vitals.spo2 ? (
                <span>
                  {vitals.spo2} <span className="text-xs text-gray-500 font-normal">%</span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>

          {/* Temp */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Thermometer className="w-3.5 h-3.5 text-amber-500" /> Temp
              </span>
              {tempBadge && <Badge color={tempBadge.color} size="sm">{tempBadge.label}</Badge>}
            </div>
            <div className="text-base font-semibold text-gray-900">
              {vitals.temperature ? (
                <span>
                  {vitals.temperature} <span className="text-xs text-gray-500 font-normal">°F</span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>

          {/* Weight & Height */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Weight className="w-3.5 h-3.5 text-gray-600" /> Wt / Ht
              </span>
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {vitals.weight || vitals.height ? (
                <span>
                  {vitals.weight ? `${vitals.weight}kg` : "--"}{" "}
                  <span className="text-gray-400 font-normal">/</span>{" "}
                  {vitals.height ? `${vitals.height}cm` : "--"}
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>

          {/* BMI */}
          <div className="rounded-lg border border-gray-100 bg-[#F7F6F3]/50 p-3 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span className="flex items-center gap-1 font-medium">
                <Ruler className="w-3.5 h-3.5 text-indigo-500" /> BMI
              </span>
              {bmiInfo && <Badge color={bmiInfo.color} size="sm">{bmiInfo.label}</Badge>}
            </div>
            <div className="text-base font-semibold text-gray-900">
              {bmiInfo ? (
                <span>
                  {bmiInfo.val} <span className="text-xs text-gray-500 font-normal">kg/m²</span>
                </span>
              ) : (
                <span className="text-gray-400 font-normal text-sm">--</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
