"use client";

import React, { useState } from "react";
import { Visit } from "@/lib/db/types";
import { checkInVisit, transitionQueueState } from "@/features/queue/actions";
import { Button } from "@/components/ui/button";
import { CheckCircle2, UserCheck, Stethoscope } from "lucide-react";

export interface StatusActionsProps {
  visit: Visit;
  onStatusChanged?: () => void;
}

export function StatusActions({ visit, onStatusChanged }: StatusActionsProps) {
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

  const handleTransition = async (target: "in_consultation" | "completed") => {
    setLoading(true);
    setError(null);
    try {
      const res = await transitionQueueState(visit.id, target);
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
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        Completed
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
          className="h-9 text-xs font-semibold px-3.5 gap-1.5"
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
          onClick={() => handleTransition("in_consultation")}
          disabled={loading}
          className="h-9 text-xs font-semibold px-3.5 gap-1.5 bg-amber-600 hover:bg-amber-700 text-white border-transparent focus:ring-amber-500"
        >
          <Stethoscope className="w-3.5 h-3.5" />
          {loading ? "Calling..." : "Call In Doctor"}
        </Button>
      )}

      {visit.status === "in_consultation" && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => handleTransition("completed")}
          disabled={loading}
          className="h-9 text-xs font-semibold px-3.5 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border-transparent focus:ring-emerald-500"
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {loading ? "Saving..." : "Mark Completed"}
        </Button>
      )}
    </div>
  );
}
