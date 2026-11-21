import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PatientIdentityHeader (V2-06 06-03a; 06-UI-SPEC PatientIdentityHeader, CD-13; DESIGN_SYSTEM §7.1): who this is, in
 * a fixed scanning order: name → age/sex (`42 y · M`) → ID → phone → ABHA → visit context (token, status, wait) →
 * safety line.
 *
 * Variants:
 * - `full` (patient profile): `<header>` landmark, the name as the page's `<h1>` in `font-display` title-2, a meta line,
 *   the visit context and the safety line (an AllergyBanner) under it;
 * - `compact` (consult top bar): name 14/600 Inter, meta 12 fg-muted;
 * - `inline` (pickers, rows): name 500 · age/sex · masked phone on one line that may wrap.
 *
 * The name is never ellipsized (at least 24 characters always show): it wraps, between words only, to at most two
 * lines. The meta line wraps in `full` and may ellipsize in `compact` (its full text stays in the accessibility
 * tree). Numbers are tabular. The avatar is initials on `surface-muted`, never colour-coded. Server or Client Component; synthetic data only in fixtures.
 */
export type PatientSex = "M" | "F" | "O";

export interface PatientIdentity {
  name: string;
  /** Display age, already formatted (`42 y`, `8 m`; lib/ui/age.ts `formatAge`). */
  age?: string | null;
  sex?: PatientSex | null;
  /** Clinic patient ID (`CQ-0042`). */
  patientCode?: string | null;
  /** Ten-digit Indian mobile number. */
  phone?: string | null;
  abhaLinked?: boolean;
}

export interface PatientIdentityHeaderProps {
  patient: PatientIdentity;
  variant?: "full" | "compact" | "inline";
  /** Visit context after the identity: TokenChip, StatusChip, wait. */
  context?: ReactNode;
  /** The safety line (AllergyBanner), drawn under the identity in `full`. */
  safety?: ReactNode;
  /** Actions at the end of the header row (`full`, `compact`). */
  actions?: ReactNode;
  /** `inline` only: trailing text such as "Last visit 2 Oct". */
  trailing?: ReactNode;
  /** `full`: the heading level of the name (1 on a profile page). */
  headingLevel?: 1 | 2 | 3 | 4;
  /** `compact`: draw the name as a heading of this level (the consult's top bar is the page's `h1`); by default it is a paragraph. */
  nameHeading?: 1 | 2 | 3 | 4;
  className?: string;
}

const SEX_WORD: Record<PatientSex, string> = { M: "male", F: "female", O: "other" };

/**
 * `RK` from "Ramesh Kumar"; one letter for a one-word name. Letters only: the first letter of the first and of the last
 * word that has one, so "Synthetic Patient 03" gives "SP", never "S0" (06-09e, design review P1).
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => /\p{L}/u.exec(word)?.[0] ?? "")
    .filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : "";
  return (first + last).toUpperCase();
}

/** `+91 98765 43210` for a ten-digit number; anything else is shown as given. */
export function formatPhone(tenDigits: string): string {
  return /^\d{10}$/.test(tenDigits) ? `+91 ${tenDigits.slice(0, 5)} ${tenDigits.slice(5)}` : tenDigits;
}

/** `+91 ••••• •3210`: only the last four digits (DESIGN_SYSTEM §5 masked form). */
export function maskPhone(tenDigits: string): string {
  const last4 = tenDigits.replace(/\D/g, "").slice(-4);
  return `+91 ••••• •${last4}`;
}

/** The masked phone with a spoken form ("mobile ending 3210"); the bullets are hidden from screen readers. */
export function MaskedPhone({ phone }: { phone: string }) {
  const last4 = phone.replace(/\D/g, "").slice(-4);
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span aria-hidden="true">{maskPhone(phone)}</span>
      <span className="sr-only">mobile ending {last4}</span>
    </span>
  );
}

/** `42 y · M` with "42 y, male" for screen readers. */
function AgeSex({ age, sex }: { age?: string | null; sex?: PatientSex | null }) {
  if (!age && !sex) return null;
  const visible = [age, sex].filter(Boolean).join(" · ");
  const spoken = [age, sex ? SEX_WORD[sex] : null].filter(Boolean).join(", ");
  return (
    <span className="tabular-nums whitespace-nowrap">
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

function Sep() {
  return (
    <span aria-hidden="true" className="text-fg-subtle">
      {" · "}
    </span>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface-muted text-caption font-semibold text-fg-secondary",
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** The identity facts after the name, in the fixed order. Phone is full in `full`/`compact`, masked in `inline`. */
function metaParts(patient: PatientIdentity, masked: boolean): ReactNode[] {
  const parts: ReactNode[] = [];
  if (patient.age || patient.sex) parts.push(<AgeSex key="age" age={patient.age} sex={patient.sex} />);
  if (patient.patientCode)
    parts.push(
      <span key="id" className="tabular-nums whitespace-nowrap">
        ID {patient.patientCode}
      </span>,
    );
  if (patient.phone)
    parts.push(
      masked ? (
        <MaskedPhone key="phone" phone={patient.phone} />
      ) : (
        <span key="phone" className="tabular-nums whitespace-nowrap">
          {formatPhone(patient.phone)}
        </span>
      ),
    );
  if (patient.abhaLinked)
    parts.push(
      <span key="abha" className="inline-flex items-center gap-0.5 whitespace-nowrap">
        ABHA
        <Check aria-hidden="true" strokeWidth={2.25} className="size-3 text-success-fg" />
        <span className="sr-only">linked</span>
      </span>,
    );
  return parts;
}

function joinParts(parts: ReactNode[]): ReactNode[] {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [<Sep key={`s${i}`} />, part]));
}

/** The name: wraps between words, at most two lines, never ellipsized for 24 characters or fewer. */
const NAME_WRAP = "line-clamp-2 break-normal text-pretty";

export function PatientIdentityHeader({
  patient,
  variant = "full",
  context,
  safety,
  actions,
  trailing,
  headingLevel = 1,
  nameHeading,
  className,
}: PatientIdentityHeaderProps) {
  if (variant === "inline") {
    const parts = metaParts(patient, true);
    return (
      <span data-identity="inline" className={cn("inline-flex min-w-0 items-start gap-2", className)}>
        <Avatar name={patient.name} />
        <span className="min-w-0 text-body-sm text-fg-muted">
          <span className={cn("font-medium text-fg", NAME_WRAP)} data-patient-name="">
            {patient.name}
          </span>
          <span className="block">
            {joinParts([...parts, ...(trailing ? [<span key="t">{trailing}</span>] : [])])}
          </span>
        </span>
      </span>
    );
  }

  if (variant === "compact") {
    const Name = nameHeading ? (`h${nameHeading}` as "h1" | "h2" | "h3" | "h4") : "p";
    return (
      <div data-identity="compact" className={cn("flex min-w-0 items-center gap-2.5", className)}>
        <div className="flex min-w-0 flex-1 flex-col">
          <Name className={cn("text-body-md font-semibold tracking-title text-fg", NAME_WRAP)} data-patient-name="">
            {patient.name}
          </Name>
          <p className="truncate text-label text-fg-muted">{joinParts(metaParts(patient, false))}</p>
        </div>
        {context && <div className="flex shrink-0 items-center gap-2">{context}</div>}
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    );
  }

  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3" | "h4";
  return (
    <header data-identity="full" className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Avatar name={patient.name} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <Heading className={cn("font-display text-title-2 text-fg", NAME_WRAP)} data-patient-name="">
            {patient.name}
          </Heading>
          <p className="text-body-sm text-fg-muted">{joinParts(metaParts(patient, false))}</p>
        </div>
        {context && <div className="flex flex-wrap items-center gap-2">{context}</div>}
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {safety}
    </header>
  );
}
