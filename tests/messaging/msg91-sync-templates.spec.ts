import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildAllPayloads,
  mapRemoteStatuses,
  formatStatusTable,
  normalizeStatus,
  StatusMap,
  WHATSAPP_TEMPLATES,
} from "@/lib/messaging/templates";
import {
  inspectTemplateStatus,
  maskKey,
} from "../../scripts/msg91-sync-templates";

describe("MSG91 Template Synchronizer & Status Inspection (D-07, Finding 7, T-05.1-07)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Dry-Run Generation & Payload Construction
  // ==========================================================================
  describe("1. Dry-Run Generation & Payload Construction", () => {
    it("proves all 13 templates produce valid MSG91 create-template payloads", () => {
      const integratedNumber = "919876543210";
      const items = buildAllPayloads(integratedNumber);

      expect(items).toHaveLength(13);
      expect(WHATSAPP_TEMPLATES).toHaveLength(13);

      for (const item of items) {
        expect(item).toHaveProperty("templateName");
        expect(typeof item.templateName).toBe("string");
        expect(item.payload).toBeDefined();

        const p = item.payload;
        expect(p.integrated_number).toBe(integratedNumber);
        expect(p.template_name).toBe(item.templateName);
        expect(typeof p.language).toBe("string");
        expect(["UTILITY", "AUTHENTICATION", "MARKETING"]).toContain(p.category);
        expect(typeof p.button_url).toBe("boolean");
        expect(Array.isArray(p.components)).toBe(true);
        expect(p.components.length).toBeGreaterThan(0);
      }
    });

    it("verifies template-specific payload properties for clinical and OTP templates", () => {
      const items = buildAllPayloads("919999888877");
      const map = new Map(items.map((i) => [i.templateName, i.payload]));

      // 1. appointment_booked: quick reply buttons, UTILITY, button_url false
      const apptBooked = map.get("appointment_booked");
      expect(apptBooked).toBeDefined();
      expect(apptBooked?.category).toBe("UTILITY");
      expect(apptBooked?.button_url).toBe(false);
      const buttonsComp = apptBooked?.components.find(
        (c: any) => c.type === "BUTTONS"
      ) as any;
      expect(buttonsComp?.buttons).toHaveLength(3);
      expect(buttonsComp?.buttons.map((b: any) => b.text)).toEqual([
        "Confirm",
        "Cancel",
        "Reschedule",
      ]);

      // 2. prescription_ready: URL button, UTILITY, button_url true
      const rx = map.get("prescription_ready");
      expect(rx).toBeDefined();
      expect(rx?.category).toBe("UTILITY");
      expect(rx?.button_url).toBe(true);

      // 3. staff_onboarding_otp: AUTHENTICATION, OTP button
      const otp = map.get("staff_onboarding_otp");
      expect(otp).toBeDefined();
      expect(otp?.category).toBe("AUTHENTICATION");
      expect(otp?.button_url).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Status Inspection Parsing (Finding 7)
  // ==========================================================================
  describe("2. Status Inspection Parsing (Finding 7)", () => {
    it("parses remote statuses from standard { data: [...] } array response", () => {
      const mockApiResponse = {
        status: "success",
        data: [
          {
            template_name: "appointment_booked",
            status: "APPROVED",
            id: "msg91_tpl_001",
          },
          {
            template_name: "appointment_rescheduled",
            status: "PENDING",
            id: "msg91_tpl_002",
          },
          {
            template_name: "appointment_cancelled",
            status: "REJECTED",
            id: "msg91_tpl_003",
            reason: "Sample variables invalid format",
          },
        ],
      };

      const statusMap = mapRemoteStatuses(mockApiResponse);

      // Verified remote templates
      expect(statusMap.get("appointment_booked")).toEqual({
        status: "APPROVED",
        id: "msg91_tpl_001",
      });
      expect(statusMap.get("appointment_rescheduled")).toEqual({
        status: "PENDING",
        id: "msg91_tpl_002",
      });
      expect(statusMap.get("appointment_cancelled")).toEqual({
        status: "REJECTED",
        id: "msg91_tpl_003",
        reason: "Sample variables invalid format",
      });

      // Unlisted template defaults to NOT SUBMITTED
      expect(statusMap.get("follow_up_due")?.status).toBe("NOT SUBMITTED");
      expect(statusMap.get("prescription_ready")?.status).toBe("NOT SUBMITTED");
    });

    it("parses remote statuses from nested { data: { templates: [...] } } object response", () => {
      const mockApiResponse = {
        data: {
          templates: [
            {
              name: "prescription_ready",
              approval_status: "approved",
              template_id: "tpl_rx_99",
            },
            {
              name: "lab_report_uploaded",
              approval_status: "in_review",
              template_id: "tpl_lab_100",
            },
            {
              name: "receipt_issued",
              approval_status: "paused",
              template_id: "tpl_rec_101",
            },
          ],
        },
      };

      const statusMap = mapRemoteStatuses(mockApiResponse);

      expect(statusMap.get("prescription_ready")).toEqual({
        status: "APPROVED",
        id: "tpl_rx_99",
      });
      expect(statusMap.get("lab_report_uploaded")).toEqual({
        status: "PENDING",
        id: "tpl_lab_100",
      });
      expect(statusMap.get("receipt_issued")).toEqual({
        status: "PAUSED",
        id: "tpl_rec_101",
      });
      expect(statusMap.get("pediatric_vaccine_due")?.status).toBe("NOT SUBMITTED");
    });

    it("parses live MSG91 response where status and template ID are nested in languages array", () => {
      const liveMsg91Response = {
        status: "success",
        hasError: false,
        data: [
          {
            category: "UTILITY",
            name: "appointment_booked",
            languages: [
              {
                id: "2280949169413708",
                msg91_template_id: 587658,
                status: "approved",
                rejection_reason: "NONE",
              },
            ],
          },
          {
            category: "UTILITY",
            name: "appointment_cancelled",
            languages: [
              {
                id: "1744242589979546",
                msg91_template_id: 587660,
                status: "rejected",
                rejection_reason: "Header format mismatch",
              },
            ],
          },
        ],
      };

      const statusMap = mapRemoteStatuses(liveMsg91Response);

      expect(statusMap.get("appointment_booked")).toEqual({
        status: "APPROVED",
        id: "2280949169413708",
      });
      expect(statusMap.get("appointment_cancelled")).toEqual({
        status: "REJECTED",
        id: "1744242589979546",
        reason: "Header format mismatch",
      });
      expect(statusMap.get("follow_up_due")?.status).toBe("NOT SUBMITTED");
    });

    it("parses direct array responses and normalizes case-insensitive statuses", () => {
      const directArray = [
        { template_name: "CONSULTATION_DOCUMENTS", status: "approved" },
        { template_name: "Follow_Up_Due", status: "Submitted" },
        { template_name: "balance_due_reminder", status: "FAILED", error: "Exceeded max length" },
      ];

      const statusMap = mapRemoteStatuses(directArray);

      // Case-insensitive lookup and status normalization
      expect(statusMap.get("consultation_documents")?.status).toBe("APPROVED");
      expect(statusMap.get("follow_up_due")?.status).toBe("PENDING");
      expect(statusMap.get("balance_due_reminder")).toEqual({
        status: "REJECTED",
        reason: "Exceeded max length",
      });
    });

    it("maps unlisted templates and unknown keys to NOT SUBMITTED", () => {
      const statusMap = mapRemoteStatuses([]);

      // All 13 catalogue templates are mapped to NOT SUBMITTED
      for (const t of WHATSAPP_TEMPLATES) {
        expect(statusMap.get(t.template_name)?.status).toBe("NOT SUBMITTED");
      }

      // Any arbitrary unlisted key also yields NOT SUBMITTED
      expect(statusMap.get("unlisted_custom_template")?.status).toBe("NOT SUBMITTED");
    });

    it("normalizes diverse raw status strings", () => {
      expect(normalizeStatus("approved")).toBe("APPROVED");
      expect(normalizeStatus("PASS")).toBe("APPROVED");
      expect(normalizeStatus("in_review")).toBe("PENDING");
      expect(normalizeStatus("submitted")).toBe("PENDING");
      expect(normalizeStatus("processing")).toBe("PENDING");
      expect(normalizeStatus("failed")).toBe("REJECTED");
      expect(normalizeStatus("fail")).toBe("REJECTED");
      expect(normalizeStatus("disabled")).toBe("PAUSED");
      expect(normalizeStatus("not submitted")).toBe("NOT SUBMITTED");
      expect(normalizeStatus(null)).toBe("NOT SUBMITTED");
      expect(normalizeStatus(undefined)).toBe("NOT SUBMITTED");
    });
  });

  // ==========================================================================
  // 3. Status Table Formatting
  // ==========================================================================
  describe("3. Status Table Formatting", () => {
    it("renders formatted ASCII table with headers, status badges, and summary counts", () => {
      const mockStatusMap = new Map();
      mockStatusMap.set("appointment_booked", {
        status: "APPROVED",
        id: "msg91_101",
      });
      mockStatusMap.set("appointment_rescheduled", {
        status: "PENDING",
        id: "msg91_102",
      });
      mockStatusMap.set("appointment_cancelled", {
        status: "REJECTED",
        id: "msg91_103",
        reason: "Sample variables missing",
      });
      mockStatusMap.set("appointment_reminder", {
        status: "PAUSED",
        id: "msg91_104",
      });
      // Remaining 9 templates default to NOT SUBMITTED

      const localNames = WHATSAPP_TEMPLATES.map((t) => t.template_name);
      const table = formatStatusTable(localNames, mockStatusMap);

      expect(table).toContain("Template Name");
      expect(table).toContain("Status");
      expect(table).toContain("Template ID");
      expect(table).toContain("Notes / Reason");

      // Verify status badges
      expect(table).toContain("APPROVED [OK]");
      expect(table).toContain("PENDING [WAIT]");
      expect(table).toContain("REJECTED [FAIL]");
      expect(table).toContain("PAUSED [HOLD]");
      expect(table).toContain("NOT SUBMITTED");

      // Verify specific details
      expect(table).toContain("msg91_101");
      expect(table).toContain("Sample variables missing");

      // Verify summary line
      expect(table).toContain(
        "Summary: 1 APPROVED | 1 PENDING | 1 REJECTED | 1 PAUSED | 9 NOT SUBMITTED (Total: 13)"
      );
    });
  });

  // ==========================================================================
  // 4. CLI Inspection & Missing Credentials Guard (T-05.1-07)
  // ==========================================================================
  describe("4. CLI Inspection & Credentials Handling", () => {
    it("returns error result when authKey or integratedNumber are omitted", async () => {
      const resMissingBoth = await inspectTemplateStatus("", "");
      expect(resMissingBoth.success).toBe(false);
      expect(resMissingBoth.error).toContain("MSG91 credentials missing");

      const resMissingKey = await inspectTemplateStatus("", "919876543210");
      expect(resMissingKey.success).toBe(false);

      const resMissingNum = await inspectTemplateStatus("authkey_123", "");
      expect(resMissingNum.success).toBe(false);
    });

    it("queries MSG91 template endpoint with correct headers and parses response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "success",
          data: [
            { template_name: "appointment_booked", status: "APPROVED", id: "t_1" },
            { template_name: "prescription_ready", status: "APPROVED", id: "t_2" },
          ],
        }),
      });

      const result = await inspectTemplateStatus(
        "test_auth_key",
        "919876543210",
        mockFetch as unknown as typeof fetch
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://control.msg91.com/api/v5/whatsapp/get-template-client/919876543210",
        {
          method: "GET",
          headers: {
            authkey: "test_auth_key",
            Accept: "application/json",
          },
        }
      );

      expect(result.statusMap).toBeDefined();
      expect(result.statusMap?.get("appointment_booked")?.status).toBe("APPROVED");
      expect(result.statusMap?.get("prescription_ready")?.status).toBe("APPROVED");
      expect(result.statusMap?.get("appointment_cancelled")?.status).toBe("NOT SUBMITTED");
      expect(result.table).toContain("Summary: 2 APPROVED");
    });

    it("handles HTTP error response gracefully", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Invalid authkey supplied",
      });

      const result = await inspectTemplateStatus(
        "bad_key",
        "919876543210",
        mockFetch as unknown as typeof fetch
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("HTTP 401: Invalid authkey supplied");
    });

    it("masks sensitive auth key strings in CLI output (T-05.1-07)", () => {
      expect(maskKey("1234567890abcdef")).toBe("1234****cdef");
      expect(maskKey("short")).toBe("********");
      expect(maskKey("")).toBe("********");
    });

    it("verifies isMain guard allows importing CLI script without running main", async () => {
      // If isMain guard works, importing scripts/msg91-sync-templates.ts in this test file
      // does NOT invoke main(), exit the process, or trigger errors.
      const syncModule = await import("../../scripts/msg91-sync-templates");
      expect(syncModule.inspectTemplateStatus).toBeDefined();
      expect(syncModule.main).toBeDefined();
      expect(syncModule.maskKey).toBeDefined();
    });
  });
});
