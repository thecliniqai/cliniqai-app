"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Visit } from "@/lib/db/types";
import { checkInVisit, transitionQueueState } from "@/features/queue/actions";
import { Button } from "@/components/ui/button";
import { CheckCircle2, UserCheck, Stethoscope, ArrowRight } from "lucide-react";

export interface StatusActionsProps {
  visit: Visit;
  onStatusChanged?: () => void;
}

export function StatusActions({ visit, onStatusChanged }: StatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await checkInVisit(visit.id);
      if (!res.success) {
        setError(res.error);
      } else {
        onStatusChanged?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check in");
    } finally {
      setLoading(false);
    }
  };

  const handleStartConsultation = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await transitionQueueState(visit.id, "in_consultation");
      if (!res.success) {
        setError(res.error);
        setLoading(false);
      } else {
        onStatusChanged?.();
        router.push(`/consultation/${visit.id}`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start consultation");
      setLoading(false);
    }
  };

  const handleMarkCompleted = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await transitionQueueState(visit.id, "completed");
      if (!res.success) {
        setError(res.error);
      } else {
        onStatusChanged?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setLoading(false);
    }
  };

  if (visit.status === "completed") {
    return (
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          Completed
        </div>
        <Link
          href={`/consultation/${visit.id}`}
          className="h-8 px-2.5 rounded-lg border border-gray-200 text-gray-600 hover:text-gray-900 hover:bg-gray-50 text-xs font-medium flex items-center gap-1 transition-colors"
        >
          <span>Review</span>
        </Link>
      </div>
    );
  }

  if (visit.status === "cancelled" || visit.status === "no_show") {
    return (
      <span className="text-xs text-gray-400 italic capitalize px-2 py-1">
        {visit.status.replace("_", " ")}
      </span>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
      {error && <span className="text-xs text-red-600 font-medium">{error}</span>}

      {(visit.status === "booked" || visit.status === "confirmed") && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleCheckIn}
          disabled={loading}
          className="h-9 text-xs font-semibold px-3.5 gap-1.5 bg-[#1769E0] text-white hover:bg-[#155cc0] cursor-pointer"
        >
          <UserCheck className="w-3.5 h-3.5" />
          {loading ? "Checking in..." : "Check In"}
        </Button>
      )}

      {visit.status === "waiting" && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleStartConsultation}
          disabled={loading}
          className="h-9 text-xs font-semibold px-3.5 gap-1.5 bg-[#1769E0] text-white hover:bg-[#155cc0] cursor-pointer shadow-2xs"
        >
          <Stethoscope className="w-3.5 h-3.5" />
          <span>{loading ? "Opening..." : "Start Consultation"}</span>
          <ArrowRight className="w-3.5 h-3.5 opacity-80" />
        </Button>
      )}

      {visit.status === "in_consultation" && (
        <div className="flex items-center gap-2">
          <Link
            href={`/consultation/${visit.id}`}
            className="h-9 px-3.5 rounded-xl bg-[#1769E0] text-white hover:bg-[#155cc0] font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Resume Consultation</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-80" />
          </Link>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleMarkCompleted}
            disabled={loading}
            className="h-9 text-xs font-medium px-2.5 rounded-xl border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer"
            title="Mark Completed"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Done</span>
          </Button>
        </div>
      )}
    </div>
  );
}
