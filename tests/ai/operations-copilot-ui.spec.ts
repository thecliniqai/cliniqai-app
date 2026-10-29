import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { ChatBubble } from "@/components/ai/chat-bubble";
import { ActionPreviewCard } from "@/components/ai/action-preview-card";
import { PatientDisambiguationCard } from "@/components/ai/patient-disambiguation-card";
import { ConflictRecoveryCard } from "@/components/ai/conflict-recovery-card";
import { QuickRegistrationCard } from "@/components/ai/quick-registration-card";
import { AppHeader } from "@/components/layout/app-header";

// Mock next/navigation for Next.js App Router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock sidebar context for AppHeader
vi.mock("@/components/layout/sidebar-context", () => ({
  useSidebar: () => ({
    isExpanded: true,
    toggleSidebar: vi.fn(),
    toggleMobileSidebar: vi.fn(),
  }),
}));

// Mock notifications
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => React.createElement("div", { "data-testid": "notification-bell" }),
}));

// Mock user dropdown
vi.mock("@/components/layout/user-dropdown", () => ({
  UserDropdown: () => React.createElement("div", { "data-testid": "user-dropdown" }),
}));

describe("Phase 05.3 Operations Copilot UI Components (D-01..D-12, UI-SPEC)", () => {
  describe("1. ChatBubble Component", () => {
    it("renders user bubble with right alignment and #F1F2F4 surface", () => {
      const html = renderToString(
        React.createElement(ChatBubble, {
          role: "user",
          content: "Can you book an appointment for tomorrow?",
        })
      );

      expect(html).toContain("Can you book an appointment for tomorrow?");
      expect(html).toContain("justify-end");
      expect(html).toContain("bg-[#F1F2F4]");
    });

    it("renders assistant bubble with left alignment, white surface, and border", () => {
      const html = renderToString(
        React.createElement(ChatBubble, {
          role: "assistant",
          content: "Here is the doctor availability for tomorrow.",
        })
      );

      expect(html).toContain("Here is the doctor availability for tomorrow.");
      expect(html).toContain("justify-start");
      expect(html).toContain("bg-white");
      expect(html).toContain("border-[#E4E5E7]");
    });
  });

  describe("2. ActionPreviewCard Component", () => {
    const defaultBookingDetails = {
      patient_name: "Ramesh Sharma",
      phone: "+919876543210",
      doctor_name: "Dr. Anjali Verma",
      date: "2026-10-30",
      start_time: "10:00",
      fee: 500,
      outside_shift_warning: false,
    };

    it("renders booking preview details with patient, doctor, slot, and fee", () => {
      const html = renderToString(
        React.createElement(ActionPreviewCard, {
          actionType: "book_appointment",
          details: defaultBookingDetails,
        })
      );

      expect(html).toContain("Appointment Booking Preview");
      expect(html).toContain("Ramesh Sharma");
      expect(html).toContain("+919876543210");
      expect(html).toContain("Dr. Anjali Verma");
      expect(html).toContain("10:00");
      expect(html).toContain("₹");
      expect(html).toContain("500");
      expect(html).toContain("Confirm Appointment Booking");
      expect(html).toContain("Cancel Booking Action");
    });

    it("displays visible amber warning badge when outside_shift_warning is true", () => {
      const html = renderToString(
        React.createElement(ActionPreviewCard, {
          actionType: "book_appointment",
          details: {
            ...defaultBookingDetails,
            outside_shift_warning: true,
          },
        })
      );

      expect(html).toContain("Schedule Warning: Outside doctor active shift hours");
      expect(html).toContain("bg-[#FFF5E5]");
      expect(html).toContain("text-[#9A5B00]");
    });

    it("renders locked confirmed badge when initialStatus is confirmed", () => {
      const html = renderToString(
        React.createElement(ActionPreviewCard, {
          actionType: "book_appointment",
          details: defaultBookingDetails,
          initialStatus: "confirmed",
        })
      );

      expect(html).toContain("Confirmed on Calendar");
      expect(html).toContain("Slot Locked");
      expect(html).toContain("Open in Calendar");
      expect(html).not.toContain("Confirm Appointment Booking");
    });

    it("renders cancelled badge for cancelled appointments", () => {
      const html = renderToString(
        React.createElement(ActionPreviewCard, {
          actionType: "cancel_appointment",
          details: {
            patient_name: "Ramesh Sharma",
            doctor_name: "Dr. Anjali Verma",
            scheduled_at: "2026-10-30 10:00 AM",
            reason: "Patient called to cancel",
          },
          initialStatus: "cancelled",
        })
      );

      expect(html).toContain("Appointment Cancelled");
      expect(html).toContain("Slot Released");
      expect(html).toContain("View Calendar");
    });
  });

  describe("3. PatientDisambiguationCard Component", () => {
    it("renders candidate chips with name, phone, age, and last visit date", () => {
      const candidates = [
        {
          id: "11111111-1111-1111-1111-111111111111",
          full_name: "Amit Kumar",
          phone: "+919876543210",
          age: 42,
          sex: "male",
          last_visit_date: "2026-10-15",
        },
        {
          id: "22222222-2222-2222-2222-222222222222",
          full_name: "Amit Kumar",
          phone: "+919123456789",
          age: 28,
          sex: "male",
          last_visit_date: null,
        },
      ];

      const html = renderToString(
        React.createElement(PatientDisambiguationCard, {
          query: "Amit",
          candidates,
          onSelect: vi.fn(),
        })
      );

      expect(html).toContain("Multiple Patients Found");
      expect(html).toContain("Amit");
      expect(html).toContain("Amit Kumar");
      expect(html).toContain("+919876543210");
      expect(html).toContain("42y M");
      expect(html).toContain("Last: 2026-10-15");
      expect(html).toContain("+919123456789");
      expect(html).toContain("Last: New Patient");
    });
  });

  describe("4. ConflictRecoveryCard Component", () => {
    it("renders conflict explanation and alternative slot recommendation chips", () => {
      const html = renderToString(
        React.createElement(ConflictRecoveryCard, {
          doctorName: "Dr. Verma",
          date: "2026-10-30",
          alternativeSlots: ["10:30 AM", "11:15 AM", "04:00 PM"],
          onSelectSlot: vi.fn(),
        })
      );

      expect(html).toContain("Slot Conflict Detected");
      expect(html).toContain("Selected slot is no longer available");
      expect(html).toContain("10:30 AM");
      expect(html).toContain("11:15 AM");
      expect(html).toContain("04:00 PM");
    });
  });

  describe("5. QuickRegistrationCard Component", () => {
    it("renders required fields for inline patient registration", () => {
      const html = renderToString(
        React.createElement(QuickRegistrationCard, {
          initialName: "Suresh Gupta",
          initialPhone: "9876543210",
          onRegistered: vi.fn(),
        })
      );

      expect(html).toContain("Quick Patient Registration");
      expect(html).toContain("Full Name *");
      expect(html).toContain("Indian Mobile Number *");
      expect(html).toContain("Register &amp; Book Patient");
      expect(html).toContain("Suresh Gupta");
    });
  });

  describe("6. Shell Integration & AppHeader Trigger Button", () => {
    it("renders CliniQ Copilot trigger button with shortcut title and aria label", () => {
      const html = renderToString(
        React.createElement(AppHeader, {
          tenantName: "Apex Multi-Speciality Clinic",
          role: "doctor",
          userEmail: "doctor@apexclinic.in",
        })
      );

      expect(html).toContain('title="CliniQ Copilot (⌘K)"');
      expect(html).toContain('aria-label="Toggle CliniQ Operations Copilot"');
      expect(html).toContain("Apex Multi-Speciality Clinic");
    });
  });
});
