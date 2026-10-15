import { describe, it, expect } from "vitest";
import { VisitStatus } from "@/lib/db/types";

// Pure helper function verifying queue action behavior per visit status
export function getActionPropsForStatus(status: VisitStatus, visitId: string) {
  switch (status) {
    case "booked":
    case "confirmed":
      return {
        primaryAction: "check_in",
        label: "Check In",
        navTarget: null,
        nextStatus: "waiting",
      };
    case "waiting":
      return {
        primaryAction: "start_consultation",
        label: "Start Consultation",
        navTarget: `/consultation/${visitId}`,
        nextStatus: "in_consultation",
      };
    case "in_consultation":
      return {
        primaryAction: "resume_consultation",
        label: "Resume Consultation",
        navTarget: `/consultation/${visitId}`,
        secondaryAction: "mark_completed",
        nextStatus: "completed",
      };
    case "completed":
      return {
        primaryAction: "review_visit",
        label: "Review",
        navTarget: `/consultation/${visitId}`,
        isTerminal: true,
      };
    case "cancelled":
    case "no_show":
      return {
        primaryAction: null,
        label: status.replace("_", " "),
        navTarget: null,
        isTerminal: true,
      };
  }
}

describe("Queue Status Actions Navigation & State Transitions (REQ-diagnosis-visit-management)", () => {
  const testVisitId = "11111111-2222-3333-4444-555555555555";

  it("provides Check In action for booked and confirmed visits", () => {
    const booked = getActionPropsForStatus("booked", testVisitId);
    expect(booked.primaryAction).toBe("check_in");
    expect(booked.label).toBe("Check In");
    expect(booked.nextStatus).toBe("waiting");

    const confirmed = getActionPropsForStatus("confirmed", testVisitId);
    expect(confirmed.primaryAction).toBe("check_in");
    expect(confirmed.label).toBe("Check In");
  });

  it("provides 1-tap Start Consultation for waiting visits leading directly to /consultation/[id]", () => {
    const waiting = getActionPropsForStatus("waiting", testVisitId);
    expect(waiting.primaryAction).toBe("start_consultation");
    expect(waiting.label).toBe("Start Consultation");
    expect(waiting.navTarget).toBe(`/consultation/${testVisitId}`);
    expect(waiting.nextStatus).toBe("in_consultation");
  });

  it("provides Resume Consultation for active visits currently in_consultation", () => {
    const active = getActionPropsForStatus("in_consultation", testVisitId);
    expect(active.primaryAction).toBe("resume_consultation");
    expect(active.label).toBe("Resume Consultation");
    expect(active.navTarget).toBe(`/consultation/${testVisitId}`);
    expect(active.secondaryAction).toBe("mark_completed");
  });

  it("provides Review link for completed consultations", () => {
    const completed = getActionPropsForStatus("completed", testVisitId);
    expect(completed.primaryAction).toBe("review_visit");
    expect(completed.navTarget).toBe(`/consultation/${testVisitId}`);
    expect(completed.isTerminal).toBe(true);
  });

  it("displays passive status for cancelled and no-show visits", () => {
    const cancelled = getActionPropsForStatus("cancelled", testVisitId);
    expect(cancelled.primaryAction).toBeNull();
    expect(cancelled.label).toBe("cancelled");
    expect(cancelled.isTerminal).toBe(true);
  });
});
