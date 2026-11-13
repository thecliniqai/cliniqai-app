"use client";

import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { en } from "@/messages/en";

/**
 * Cloudflare Turnstile on sign-in and the reset request (V2-03 03-12c; C43 Managed mode, R-22).
 *
 * Renders the widget when `siteKey` is set (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`; unset = nothing rendered). The page
 * asks the handle for a token when the form is submitted and passes it to Supabase (`options.captchaToken`); Supabase
 * verifies it with Cloudflare, the app never calls `siteverify`. Tokens are single-use, so the page calls `reset()`
 * after every attempt. Expiry refreshes automatically (`refresh-expired: auto`); failures retry automatically.
 *
 * States with accessible copy in a polite live region: loading, failed (the widget's error callback), expired
 * (until the refresh issues a new token) and unavailable (the Cloudflare script did not load). Copy comes from
 * `messages/en.ts`.
 */

export type TurnstileStatus = "loading" | "pending" | "ready" | "failed" | "expired" | "unavailable";

export interface TurnstileFieldHandle {
  /**
   * The current token. While the widget is still working (loading, pending, refreshing after expiry) this waits up
   * to `timeoutMs` for it; it returns `null` at once when the widget failed or could not load.
   */
  token(timeoutMs?: number): Promise<string | null>;
  /** Discards the used token and asks the widget for a new one. */
  reset(): void;
}

export interface TurnstileFieldProps {
  /** The Turnstile site key; when unset nothing renders and `token()` resolves `null`. */
  siteKey: string | undefined;
  /** Unique per page: the widget container's id. */
  id: string;
  /** Turnstile action name shown in Cloudflare analytics (`[A-Za-z0-9_-]{1,32}`). */
  action: string;
  /**
   * `always` (default): the Managed widget is visible. `interaction-only`: it appears only when Cloudflare needs the
   * user to interact (used for the secondary "Resend code" action, so the reset step shows one primary form).
   */
  appearance?: "always" | "interaction-only";
}

const DEFAULT_WAIT_MS = 15_000;

const STATUS_COPY: Partial<Record<TurnstileStatus, string>> = {
  failed: en.auth.captcha.failed,
  expired: en.auth.captcha.expired,
  unavailable: en.auth.captcha.unavailable,
};

export const TurnstileField = React.forwardRef<TurnstileFieldHandle, TurnstileFieldProps>(function TurnstileField(
  { siteKey, id, action, appearance = "always" },
  ref,
) {
  const widget = useRef<TurnstileInstance | null>(null);
  const tokenRef = useRef<string | null>(null);
  const statusRef = useRef<TurnstileStatus>("loading");
  const waiters = useRef<Array<(token: string | null) => void>>([]);
  const [status, setStatus] = useState<TurnstileStatus>("loading");

  const update = useCallback((next: TurnstileStatus, token: string | null) => {
    statusRef.current = next;
    tokenRef.current = token;
    setStatus(next);
    // A token, or a state the user must act on, settles every waiting submit.
    if (token !== null || next === "failed" || next === "unavailable") {
      const settled = waiters.current;
      waiters.current = [];
      for (const resolve of settled) resolve(token);
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      token(timeoutMs = DEFAULT_WAIT_MS) {
        if (!siteKey) return Promise.resolve(null);
        if (tokenRef.current) return Promise.resolve(tokenRef.current);
        if (statusRef.current === "failed" || statusRef.current === "unavailable") return Promise.resolve(null);
        return new Promise<string | null>((resolve) => {
          const timer = setTimeout(() => {
            waiters.current = waiters.current.filter((w) => w !== settle);
            resolve(null);
          }, timeoutMs);
          const settle = (token: string | null) => {
            clearTimeout(timer);
            resolve(token);
          };
          waiters.current.push(settle);
        });
      },
      reset() {
        if (!siteKey) return;
        update("pending", null);
        widget.current?.reset();
      },
    }),
    [siteKey, update],
  );

  if (!siteKey) return null;

  const message = STATUS_COPY[status];
  return (
    <div className="space-y-2" data-turnstile-status={status}>
      <Turnstile
        ref={widget}
        id={id}
        siteKey={siteKey}
        options={{
          action,
          theme: "light",
          language: "en",
          size: "flexible",
          appearance,
          refreshExpired: "auto",
          retry: "auto",
          // The form is submitted by script; no hidden `cf-turnstile-response` input is needed.
          responseField: false,
        }}
        scriptOptions={{ onError: () => update("unavailable", null) }}
        onWidgetLoad={() => {
          if (statusRef.current === "loading") update("pending", null);
        }}
        onSuccess={(token) => update("ready", token)}
        onError={() => update("failed", null)}
        onExpire={() => update("expired", null)}
        onTimeout={() => update("expired", null)}
        onUnsupported={() => update("unavailable", null)}
      />
      <p role="status" aria-live="polite" className={message ? "text-sm text-red-700" : "sr-only"}>
        {message ?? (status === "loading" ? en.auth.captcha.loading : "")}
      </p>
    </div>
  );
});
