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
      <div className="flex items-center text-xs text-[var(--status-success)] font-medium">
        <CheckCircle2 className="w-4 h-4 mr-1" />
        Completed
      </div>
    );
  }

  if (visit.status === "cancelled" || visit.status === "no_show") {
    return (
      <span className="text-xs text-[var(--text-muted)] italic capitalize">
        {visit.status.replace("_", " ")}
      </span>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2">
      {error && <span className="text-xs text-[var(--status-error)]">{error}</span>}

      {(visit.status === "booked" || visit.status === "confirmed") && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleCheckIn}
          disabled={loading}
          className="h-8 text-xs font-semibold px-3"
        >
          <UserCheck className="w-3.5 h-3.5 mr-1" />
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
          className="h-8 text-xs font-semibold px-3 bg-[var(--status-warning-text)] hover:bg-[var(--status-warning-text)]/90 text-white"
        >
          <Stethoscope className="w-3.5 h-3.5 mr-1" />
          {loading ? "Calling..." : "Send to Doctor"}
        </Button>
      )}

      {visit.status === "in_consultation" && (
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => handleTransition("completed")}
          disabled={loading}
          className="h-8 text-xs font-semibold px-3 bg-[var(--status-success)] hover:bg-[var(--status-success)]/90 text-white"
        >
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          {loading ? "Saving..." : "Mark Completed"}
        </Button>
      )}
    </div>
  );
}
