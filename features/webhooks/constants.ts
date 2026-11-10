export const ALLOWED_WEBHOOK_EVENTS = [
  "appointment.booked",
  "appointment.cancelled",
  "appointment.rescheduled",
  "visit.completed",
  "lab_result.ready",
  "prescription.issued",
] as const;

export type AllowedWebhookEvent = (typeof ALLOWED_WEBHOOK_EVENTS)[number];

export interface WebhookSubscriptionItem {
  id: string;
  endpointUrl: string;
  eventTypes: string[];
  signingSecret: string;
  isActive: boolean;
  createdAt: string;
}

export interface WebhookDeliveryLogItem {
  id: string;
  subscriptionId: string;
  eventType: string;
  payload: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  retryCount: number;
  maxRetries: number;
  responseStatus: number | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
}
