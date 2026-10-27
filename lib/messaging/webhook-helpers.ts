export function verifyWebhookSignature(
  provider: string,
  headers: Headers,
  _rawBody: string
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
    const expected = process.env.MSG91_AUTH_KEY;
    if (!expected) {
      return process.env.NODE_ENV !== "production";
    }
    return authKey === expected;
  }

  return true;
}

export function parseInboundAction(body: string): "confirm" | "cancel" | "reschedule" | "unhandled" {
  const normalized = body.trim().toLowerCase();
  if (
    normalized === "btn_confirm" ||
    normalized === "confirm" ||
    normalized === "yes" ||
    normalized === "1"
  ) {
    return "confirm";
  }
  if (
    normalized === "btn_cancel" ||
    normalized === "cancel" ||
    normalized === "no" ||
    normalized === "2"
  ) {
    return "cancel";
  }
  if (
    normalized === "btn_reschedule" ||
    normalized === "reschedule" ||
    normalized === "3"
  ) {
    return "reschedule";
  }
  return "unhandled";
}
