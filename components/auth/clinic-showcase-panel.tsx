"use client";

import React from "react";
import {
  Stethoscope,
  ShieldCheck,
  Activity,
  Clock,
  Users,
  CheckCircle2,
  Lock,
  Sparkles,
} from "lucide-react";

export function ClinicShowcasePanel() {
  return (
    <div className="hidden lg:flex lg:w-1/2 min-h-screen bg-slate-50/70 border-r border-gray-200 relative overflow-hidden flex-col justify-between p-10 xl:p-14 select-none">
      {/* Decorative Blueprint Background Grid Pattern */}
      <div
        className="absolute inset-0 pointer-events-none opacity-40"
        style={{
          backgroundImage: `radial-gradient(#CBD5E1 1px, transparent 1px)`,
          backgroundSize: "24px 24px",
        }}
        aria-hidden="true"
      />

      {/* Decorative subtle ambient soft glow */}
      <div
        className="absolute -top-32 -left-32 w-96 h-96 bg-blue-100/40 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-32 -right-32 w-96 h-96 bg-indigo-100/30 rounded-full blur-3xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Top Header: Brand & Accreditations */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1769E0] text-white flex items-center justify-center shadow-theme-xs">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-gray-900 block leading-tight">
              ClinicOS
            </span>
            <span className="text-[11px] font-medium text-gray-500 tracking-wide">
              Healthcare Operating System
            </span>
          </div>
        </div>

        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>ABDM M1/M2/M3 Ready</span>
        </span>
      </div>

      {/* Centerpiece: Headline + Live Clinic Simulation Card */}
      <div className="relative z-10 my-8 space-y-6 max-w-xl">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-blue-50 text-[#1769E0] border border-blue-100 mb-3">
            <Sparkles className="w-3 h-3 text-[#1769E0]" />
            <span>High-Throughput Outpatient Operations</span>
          </div>
          <h1 className="text-2xl xl:text-3xl font-extrabold tracking-tight text-gray-900 leading-snug">
            Streamline clinic queues, consultations, and patient records with zero operational friction.
          </h1>
          <p className="text-xs xl:text-sm text-gray-600 mt-2.5 leading-relaxed">
            Built for modern clinics and multi-doctor polyclinics. Instant walk-in check-in, live token routing, and secure ABDM-linked health records.
          </p>
        </div>

        {/* Live OPD Simulation Dashboard Card */}
        <div className="bg-white rounded-2xl border border-gray-200/90 shadow-theme-md p-5 space-y-4">
          {/* Card Header: Doctor & Room Status */}
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-50 text-[#1769E0] flex items-center justify-center font-bold text-xs">
                DR
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">
                  Dr. Ramesh Sharma
                </h4>
                <p className="text-[11px] text-gray-500">
                  General Medicine · Room OPD 1
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>In Consultation</span>
            </div>
          </div>

          {/* Current Called Token Bar */}
          <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="px-2.5 py-1 bg-[#1769E0] text-white text-xs font-bold rounded-lg shadow-2xs font-mono">
                Token #18
              </span>
              <div>
                <p className="text-xs font-bold text-gray-900">
                  Anita Sharma <span className="font-normal text-gray-500 text-[11px]">(42y · Female)</span>
                </p>
                <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5">
                  <Activity className="w-3 h-3 text-[#1769E0]" />
                  <span>BP 120/80 mmHg · SpO2 99% · Pulse 72 bpm</span>
                </p>
              </div>
            </div>
            <span className="text-[10px] font-semibold text-[#1769E0] bg-white px-2 py-0.5 rounded-md border border-blue-100">
              Active Call
            </span>
          </div>

          {/* Quick Metrics Strip */}
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium flex items-center justify-center gap-1">
                <Users className="w-3 h-3 text-amber-500" />
                <span>Waiting</span>
              </div>
              <div className="text-sm font-bold text-gray-900 mt-0.5 font-mono">
                3 Patients
              </div>
            </div>

            <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                <span>Completed</span>
              </div>
              <div className="text-sm font-bold text-gray-900 mt-0.5 font-mono">
                14 Today
              </div>
            </div>

            <div className="p-2 rounded-lg bg-gray-50 border border-gray-100">
              <div className="text-[10px] text-gray-500 font-medium flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 text-blue-500" />
                <span>Avg Wait</span>
              </div>
              <div className="text-sm font-bold text-gray-900 mt-0.5 font-mono">
                6.5 mins
              </div>
            </div>
          </div>
        </div>

        {/* Floating Trust Metric Badges */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 shadow-2xs text-xs font-semibold text-gray-700">
            <span className="text-amber-500">⚡</span>
            <span>&lt; 2s Patient Registration</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 shadow-2xs text-xs font-semibold text-gray-700">
            <Lock className="w-3 h-3 text-[#1769E0]" />
            <span>Multi-Tenant Database RLS</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-gray-200 shadow-2xs text-xs font-semibold text-gray-700">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>100% Indian Data Residency</span>
          </div>
        </div>
      </div>

      {/* Bottom Footer: Doctor Testimonial & Copyright */}
      <div className="relative z-10 pt-4 border-t border-gray-200/80">
        <blockquote className="text-xs text-gray-600 italic">
          &ldquo;ClinicOS transformed our morning OPD queues. Patients check in under 3 seconds, and doctors have instant longitudinal history at their fingertips.&rdquo;
        </blockquote>
        <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
          <span className="font-semibold text-gray-800 not-italic">
            Dr. Priya Patel, Medical Director
          </span>
          <span className="text-gray-400">
            ISO 27001 Aligned · End-to-End Encrypted
          </span>
        </div>
      </div>
    </div>
  );
}
