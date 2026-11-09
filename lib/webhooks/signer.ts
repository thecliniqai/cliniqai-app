import crypto from "crypto";

export interface WebhookSignatureResult {
  header: string;
  signature: string;
  timestamp: number;
}

/**
 * Computes an HMAC-SHA256 signature over `${timestamp}.${payloadString}`
 * using the subscription's signing secret, matching the Stripe webhook standard.
 *
 * Header format: `X-ClinicQ-Signature: t={timestamp},v1={hex_signature}`
 */
export function generateWebhookSignature(
  payloadString: string,
  secret: string,
  timestamp?: number
): WebhookSignatureResult {
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${t}.${payloadString}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  const header = `t=${t},v1=${signature}`;

  return {
    header,
    signature,
    timestamp: t,
  };
}

/**
 * Verifies that a webhook request's `X-ClinicQ-Signature` matches the computed signature
 * using constant-time comparison, and that the signature timestamp is within the tolerance window.
 *
 * @param payloadString The exact raw string body of the request.
 * @param header The `X-ClinicQ-Signature` header value (`t=...,v1=...`).
 * @param secret The webhook subscription's signing secret.
 * @param toleranceSeconds Maximum acceptable clock skew/age (default: 300 seconds).
 */
export function verifyWebhookSignature(
  payloadString: string,
  header: string,
  secret: string,
  toleranceSeconds: number = 300
): { valid: boolean; error?: string } {
  if (!header || typeof header !== "string") {
    return { valid: false, error: "Missing or invalid signature header." };
  }

  // Parse `t={timestamp},v1={hex_signature}`
  const items = header.split(",");
  let timestampStr: string | undefined;
  let signature: string | undefined;

  for (const item of items) {
    const [k, ...vParts] = item.trim().split("=");
    const v = vParts.join("=");
    if (k === "t") timestampStr = v;
    if (k === "v1") signature = v;
  }

  if (!timestampStr || !signature) {
    return { valid: false, error: "Malformed signature header format: expected 't={timestamp},v1={signature}'." };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { valid: false, error: "Invalid timestamp in signature header." };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, error: "Webhook signature timestamp is outside the allowable tolerance window." };
  }

  const expectedSignedPayload = `${timestamp}.${payloadString}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(expectedSignedPayload)
    .digest("hex");

  try {
    const sigBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (sigBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: "Signature mismatch." };
    }

    const matches = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!matches) {
      return { valid: false, error: "Signature mismatch." };
    }
  } catch {
    return { valid: false, error: "Invalid signature encoding." };
  }

  return { valid: true };
}
