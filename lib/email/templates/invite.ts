/**
 * The staff invitation email (V2-05 05-07b, AUTH-06, AUTH_REDESIGN §3.2; R-30). Sent only by the `email.invite` job
 * handler, with a token minted at send time. Link-only: the clinic's name, the invited role, the `/join` link and the
 * expiry (IST). No patient data, no storage URL, no inviter identity, no address other than the recipient's own.
 *
 * Every interpolated value is escaped in the HTML part; the clinic name is clamped to one line of at most 120
 * characters (a clinic name is free text written by its owner).
 */
import type { EmailTag } from "../types";

export const STAFF_INVITE_TAG: EmailTag = "staff-invite";

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: "Owner",
  admin: "Administrator",
  doctor: "Doctor",
  nurse: "Nurse",
  receptionist: "Receptionist",
};

export interface InviteEmailInput {
  clinicName: string;
  role: string;
  /** The absolute `/join?token=…` link. */
  joinUrl: string;
  expiresAt: string;
}

export interface RenderedInviteEmail {
  subject: string;
  text: string;
  html: string;
  tag: EmailTag;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One line, control characters removed, at most 120 characters. */
function oneLine(value: string): string {
  const flat = value.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat || "your clinic";
}

const IST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatInviteExpiry(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "in 72 hours" : `${IST.format(at)} IST`;
}

export function roleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABELS, role) ? ROLE_LABELS[role] : "Staff member";
}

export function renderInviteEmail(input: InviteEmailInput): RenderedInviteEmail {
  const clinic = oneLine(input.clinicName);
  const role = roleLabel(input.role);
  const expiry = formatInviteExpiry(input.expiresAt);
  const subject = `You're invited to join ${clinic} on ClinicOS`;

  const text = [
    `You have been invited to join ${clinic} on ClinicOS as ${role}.`,
    "",
    "Open this link to accept the invitation:",
    input.joinUrl,
    "",
    `The link works once and expires on ${expiry}.`,
    "If you were not expecting this invitation, you can ignore this email.",
    "",
  ].join("\n");

  const html = [
    "<!doctype html><html><body>",
    "<h1>You have been invited to ClinicOS</h1>",
    `<p>You have been invited to join <strong>${escapeHtml(clinic)}</strong> on ClinicOS as ${escapeHtml(role)}.</p>`,
    `<p><a href="${escapeHtml(input.joinUrl)}">Accept the invitation</a></p>`,
    `<p>The link works once and expires on ${escapeHtml(expiry)}.</p>`,
    "<p>If you were not expecting this invitation, you can ignore this email.</p>",
    "</body></html>",
  ].join("");

  return { subject, text, html, tag: STAFF_INVITE_TAG };
}
