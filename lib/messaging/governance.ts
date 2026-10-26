import { CommunicationChannel, PatientCommunicationPreferences, TenantMessagingConfig } from "@/lib/db/types";

export interface MessageEligibilityParams {
  tenantId: string;
  eventType: string;
  patientId?: string | null;
  requestedChannel: CommunicationChannel;
  isUrgent?: boolean;
  config?: Partial<TenantMessagingConfig> | null;
  patientPreferences?: Partial<PatientCommunicationPreferences> | null;
  now?: Date;
}

export interface MessageEligibilityResult {
  eligible: boolean;
  resolvedChannel: CommunicationChannel;
  templateId: string;
  delayUntil?: Date;
  reason?: string;
  language: "en" | "mr";
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Checks whether a given timestamp falls within Indian Standard Time (IST, UTC+5:30) quiet hours.
 * Default quiet hours are 21:00 (9 PM) to 08:00 (8 AM) IST.
 */
export function isQuietHours(
  time = new Date(),
  startHour = 21,
  endHour = 8
): boolean {
  const istDate = new Date(time.getTime() + IST_OFFSET_MS);
  const istHour = istDate.getUTCHours();

  if (startHour > endHour) {
    // Overnight quiet hours, e.g. 21:00 to 08:00
    return istHour >= startHour || istHour < endHour;
  }
  return istHour >= startHour && istHour < endHour;
}

/**
 * Calculates the next eligible dispatch timestamp after quiet hours (default 08:01 IST).
 */
export function calculateNextEligibleSendTime(
  fromTime = new Date(),
  targetHour = 8,
  targetMinute = 1
): Date {
  const istDate = new Date(fromTime.getTime() + IST_OFFSET_MS);
  const isPastTargetHour = istDate.getUTCHours() >= targetHour;
  const targetDayOffset = isPastTargetHour ? 1 : 0;

  const nextIstDate = new Date(
    Date.UTC(
      istDate.getUTCFullYear(),
      istDate.getUTCMonth(),
      istDate.getUTCDate() + targetDayOffset,
      targetHour,
      targetMinute,
      0,
      0
    )
  );

  return new Date(nextIstDate.getTime() - IST_OFFSET_MS);
}

/**
 * Two-tier message governance evaluation engine:
 * Company Master Policy -> Clinic Config -> Patient Preferences -> Quiet Hours -> Delivery Decision.
 */
export function evaluateMessageEligibility({
  eventType,
  requestedChannel,
  isUrgent = false,
  config,
  patientPreferences,
  now = new Date(),
}: MessageEligibilityParams): MessageEligibilityResult {
  const language = patientPreferences?.preferred_language || "en";
  let resolvedChannel: CommunicationChannel = requestedChannel;

  // 1. In-App notifications are internal clinic cues; always permitted with zero external quota impact
  if (requestedChannel === "in_app") {
    return {
      eligible: true,
      resolvedChannel: "in_app",
      templateId: eventType,
      language,
    };
  }

  // 2. Check Monthly Clinic Messaging Quota
  if (config) {
    const monthlyQuota = config.monthly_quota ?? 200;
    const sentThisMonth = config.messages_sent_this_month ?? 0;
    if (sentThisMonth >= monthlyQuota && !isUrgent) {
      return {
        eligible: false,
        resolvedChannel: "in_app",
        templateId: eventType,
        reason: "monthly_quota_exhausted",
        language,
      };
    }

    // Check clinic-level channel toggles
    if (requestedChannel === "whatsapp" && config.whatsapp_enabled === false) {
      if (config.sms_enabled) {
        resolvedChannel = "sms";
      } else {
        return {
          eligible: false,
          resolvedChannel: "in_app",
          templateId: eventType,
          reason: "all_external_channels_disabled",
          language,
        };
      }
    } else if (requestedChannel === "sms" && config.sms_enabled === false) {
      if (config.whatsapp_enabled) {
        resolvedChannel = "whatsapp";
      } else {
        return {
          eligible: false,
          resolvedChannel: "in_app",
          templateId: eventType,
          reason: "all_external_channels_disabled",
          language,
        };
      }
    }
  }

  // 3. Patient Preferences & Consent (D-11)
  if (patientPreferences?.whatsapp_opt_out && resolvedChannel === "whatsapp") {
    // Fallback to SMS if the event permits SMS fallback
    const permitsSmsFallback =
      eventType === "appointment_booked" ||
      eventType === "appointment_rescheduled" ||
      eventType === "otp_login";

    if (permitsSmsFallback && config?.sms_enabled !== false) {
      resolvedChannel = "sms";
    } else {
      return {
        eligible: false,
        resolvedChannel: "in_app",
        templateId: eventType,
        reason: "patient_whatsapp_opt_out",
        language,
      };
    }
  }

  // 4. Quiet Hours Filter (D-10)
  let delayUntil: Date | undefined;
  const quietHoursActive = config?.quiet_hours_enabled !== false && isQuietHours(now);

  if (quietHoursActive && !isUrgent) {
    delayUntil = calculateNextEligibleSendTime(now);
  }

  return {
    eligible: true,
    resolvedChannel,
    templateId: `${eventType}_${language}`,
    delayUntil,
    language,
  };
}
