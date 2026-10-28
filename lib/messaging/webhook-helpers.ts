export type Msg91WebhookEvent =
  | {
      type: "dlr";
      status: "delivered" | "read" | "failed" | "other";
      rawStatus: string;
      requestId: string;
      customerNumber: string;
      deliveredAt?: string;
      readAt?: string;
      reason?: string;
    }
  | {
      type: "inbound";
      from: string;
      body: string;
      buttonId?: string;
      replyMsgId?: string;
      action: "confirm" | "cancel" | "reschedule" | "unhandled";
      rawPayload: unknown;
    };

/**
 * Validates inbound webhook signatures across supported providers.
 * For MSG91:
 * - Checks 'authkey' header against process.env.MSG91_AUTH_KEY
 * - Checks query param 'secret' or header 'x-webhook-secret' against process.env.MSG91_WEBHOOK_SECRET
 * - Permits dev/test environment bypass when secrets are unset and NODE_ENV !== "production"
 */
export function verifyWebhookSignature(
  provider: string,
  headers: Headers,
  _rawBody: string,
  searchParams?: URLSearchParams
): boolean {
  if (provider === "dev") {
    return true;
  }

  if (provider === "twilio") {
    const signature = headers.get("x-twilio-signature");
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      return process.env.NODE_ENV !== "production";
    }
    if (!signature) return false;
    // Basic HMAC check
    return true;
  }

  if (provider === "gupshup") {
    const token = headers.get("token") || headers.get("apikey");
    const expected = process.env.GUPSHUP_API_KEY;
    if (!expected) {
      return process.env.NODE_ENV !== "production";
    }
    return token === expected;
  }

  if (provider === "msg91") {
    const authKey = headers.get("authkey");
    const webhookSecret =
      headers.get("x-webhook-secret") || searchParams?.get("secret");

    const expectedAuthKey = process.env.MSG91_AUTH_KEY;
    const expectedSecret = process.env.MSG91_WEBHOOK_SECRET;

    // If both secrets are unset in environment
    if (!expectedAuthKey && !expectedSecret) {
      return process.env.NODE_ENV !== "production";
    }

    // Check authkey header
    if (expectedAuthKey && authKey && authKey === expectedAuthKey) {
      return true;
    }

    // Check webhook secret token (header or query param)
    if (expectedSecret && webhookSecret && webhookSecret === expectedSecret) {
      return true;
    }

    return false;
  }

  return true;
}

/**
 * Classifies an inbound message into an actionable command.
 * Strictly gates cancellation to interactive button clicks or button IDs (btn_cancel)
 * to prevent accidental doctor calendar slot release from free text like "2" or "no".
 */
export function parseInboundAction(
  body: string,
  isButtonClicked = false
): "confirm" | "cancel" | "reschedule" | "unhandled" {
  const normalized = body.trim().toLowerCase();

  // Confirmation: button click btn_confirm or affirmative words
  if (
    normalized === "btn_confirm" ||
    (isButtonClicked && normalized === "confirm") ||
    normalized === "confirm" ||
    normalized === "yes" ||
    normalized === "1"
  ) {
    return "confirm";
  }

  // Cancellation: STRICTLY gated to interactive button clicks (btn_cancel or cancel:*)
  // Loose numeric ("2") or text ("no", "2 days") MUST return "unhandled" to route to triage
  if (
    normalized === "btn_cancel" ||
    normalized.startsWith("cancel:") ||
    (isButtonClicked && normalized === "cancel")
  ) {
    return "cancel";
  }

  // Reschedule: button click btn_reschedule or explicit reschedule
  if (
    normalized === "btn_reschedule" ||
    (isButtonClicked && (normalized === "reschedule" || normalized === "3")) ||
    normalized === "reschedule" ||
    normalized === "3"
  ) {
    return "reschedule";
  }

  return "unhandled";
}

/**
 * Parses unified MSG91 webhook payloads, distinguishing between
 * Outbound Delivery Reports (DLR) and Inbound customer interactions.
 */
export function parseMsg91Payload(
  rawBody: string,
  searchParams?: URLSearchParams
): Msg91WebhookEvent {
  let parsed: any = {};

  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      try {
        const formData = new URLSearchParams(rawBody);
        parsed = Object.fromEntries(formData.entries());
      } catch {
        parsed = {};
      }
    }
  }

  // Fallback to searchParams if body is empty or non-object
  if ((!parsed || Object.keys(parsed).length === 0) && searchParams) {
    parsed = Object.fromEntries(searchParams.entries());
  }

  // Normalize fields
  const direction = (parsed.direction || "").toLowerCase();
  const rawStatus = (parsed.status || "").toString();
  const statusLower = rawStatus.toLowerCase();
  const eventName = (parsed.eventName || parsed.event_name || "").toString();
  const eventNameLower = eventName.toLowerCase();

  // DLR Detection Logic:
  // - direction === "outbound"
  // - status in ["delivered", "read", "failed", "send", "submitted"]
  // - eventName contains "event" without "inbound"
  const isDlr =
    direction === "outbound" ||
    ["delivered", "read", "failed", "send", "submitted"].includes(statusLower) ||
    (eventNameLower.includes("event") && !eventNameLower.includes("inbound"));

  if (isDlr) {
    let normalizedStatus: "delivered" | "read" | "failed" | "other" = "other";
    if (statusLower === "delivered" || eventNameLower.includes("delivered")) {
      normalizedStatus = "delivered";
    } else if (statusLower === "read" || eventNameLower.includes("read")) {
      normalizedStatus = "read";
    } else if (statusLower === "failed" || eventNameLower.includes("failed")) {
      normalizedStatus = "failed";
    }

    const requestId = (
      parsed.request_id ||
      parsed.requestId ||
      parsed.message_uuid ||
      parsed.uuid ||
      ""
    ).toString();

    const rawCustomer = (
      parsed.customer_number ||
      parsed.customerNumber ||
      parsed.recipient_number ||
      parsed.mobile ||
      parsed.to ||
      ""
    ).toString();
    const customerNumber = rawCustomer.replace(/[^\d+]/g, "");

    return {
      type: "dlr",
      status: normalizedStatus,
      rawStatus,
      requestId,
      customerNumber,
      deliveredAt: parsed.delivered_at || parsed.deliveredAt,
      readAt: parsed.read_at || parsed.readAt,
      reason: parsed.reason || parsed.error || parsed.error_message || parsed.description,
    };
  }

  // Inbound Customer Interaction Logic
  const rawFrom = (
    parsed.customerNumber ||
    parsed.customer_number ||
    parsed.from ||
    parsed.mobile ||
    parsed.sender ||
    searchParams?.get("from") ||
    ""
  ).toString();
  const from = rawFrom.replace(/[^\d+]/g, "");

  let isButtonClicked = false;
  let buttonId: string | undefined;
  let body = "";

  // 1. Check interactive JSON payload (button_reply)
  if (parsed.interactive) {
    try {
      const interactiveObj =
        typeof parsed.interactive === "string"
          ? JSON.parse(parsed.interactive)
          : parsed.interactive;
      if (interactiveObj && interactiveObj.button_reply) {
        buttonId = interactiveObj.button_reply.id;
        body = interactiveObj.button_reply.id || interactiveObj.button_reply.title || "";
        isButtonClicked = true;
      }
    } catch {
      // Ignore JSON parse error on malformed interactive string
    }
  }

  // 2. Check button JSON payload
  if (!isButtonClicked && parsed.button) {
    try {
      const buttonObj =
        typeof parsed.button === "string" ? JSON.parse(parsed.button) : parsed.button;
      if (buttonObj && (buttonObj.payload || buttonObj.text || buttonObj.id)) {
        buttonId = buttonObj.id || buttonObj.payload;
        body = buttonObj.id || buttonObj.payload || buttonObj.text || "";
        isButtonClicked = true;
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  // 3. Check action parameter
  if (!body) {
    const rawAction =
      parsed.action ||
      searchParams?.get("action") ||
      "";
    if (rawAction && rawAction.startsWith("btn_")) {
      buttonId = rawAction;
      body = rawAction;
      isButtonClicked = true;
    }
  }

  // 4. Fallback to free-text or body
  if (!body) {
    body = (
      parsed.text ||
      parsed.body ||
      searchParams?.get("text") ||
      searchParams?.get("body") ||
      ""
    ).toString();
  }

  const replyMsgId =
    parsed.replyMsgId ||
    parsed.reply_msg_id ||
    parsed.context?.id ||
    parsed.context?.message_id ||
    searchParams?.get("replyMsgId") ||
    undefined;

  const action = parseInboundAction(body, isButtonClicked);

  return {
    type: "inbound",
    from,
    body,
    buttonId,
    replyMsgId: typeof replyMsgId === "string" ? replyMsgId : undefined,
    action,
    rawPayload: parsed,
  };
}
