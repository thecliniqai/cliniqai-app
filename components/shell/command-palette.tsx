"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Hash, UserPlus, UserRoundPlus, UsersRound } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@/components/ui/command";
import { PatientIdentityHeader } from "@/components/clinical/patient-identity-header";
import { searchPatientsForPalette, type PalettePatient } from "@/features/patients/actions";
import { searchTodayQueueForPalette, type PaletteQueueMatch } from "@/features/queue/actions";
import { reportClientError } from "@/lib/log/client";
import { allDestinations, type NavAction, type NavModel } from "@/lib/nav/nav-for-role";
import { visitStatus } from "@/lib/visit-status";
import { NavIcon } from "./nav-icon";
import { PALETTE_PLACEHOLDER } from "./top-bar";

/** Debounce before the server searches run (06-UI-SPEC SearchField: 200 ms). */
export const PALETTE_DEBOUNCE_MS = 200;
/** Shortest query sent to the patient search (the server refuses shorter ones anyway). */
const MIN_PATIENT_QUERY = 2;

const ACTION_ICON: Record<string, React.ReactNode> = {
  register: <UserPlus />,
  "walk-in": <UserRoundPlus />,
  book: <CalendarPlus />,
  invite: <UsersRound />,
};

interface Results {
  query: string;
  patients: PalettePatient[];
  queue: PaletteQueueMatch[];
}

const EMPTY: Results = { query: "", patients: [], queue: [] };

const matches = (label: string, q: string) => label.toLowerCase().includes(q.toLowerCase());

/**
 * The command palette (V2-06 06-04b; IA §3.7, DESIGN_SYSTEM §7.9, 06-UI-SPEC §6 "Command palette"). Opened with
 * ⌘K / Ctrl+K, the top bar's palette field or the phone's Search button (the shell owns the shortcut); 06-02b's
 * `CommandDialog` skin (a centred panel, full screen below 768 px with a Close button).
 *
 * Groups, in order: **Patients** (server action `searchPatientsForPalette`: `patients:view`, the session's clinic, four
 * fields; the row is the `inline` identity with a masked phone) · **Today queue** (`searchTodayQueueForPalette`: token,
 * name, status) · **Actions** (role-filtered, v1 targets only) · **Navigate** (`navForRole`). No Assist/AI group (R-35).
 * An empty query shows Actions and Navigate only: no recent patients, and nothing is persisted (CD-19): the query and
 * the results live in this component's memory and are cleared when the palette closes.
 *
 * The first row of the newest answer is the active one until the user moves the selection, so typing a mobile number
 * and pressing Enter opens that patient. The result count is announced politely.
 */
export function CommandPalette({
  open,
  onOpenChange,
  model,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: NavModel;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState("");
  const [userPicked, setUserPicked] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const destinations = useMemo(() => allDestinations(model), [model]);
  const hrefs = useMemo(() => new Set(destinations.map((d) => d.href)), [destinations]);
  const canSearchPatients = hrefs.has("/patients");
  const queueHref = ["/queue", "/cabin", "/"].find((h) => hrefs.has(h)) ?? null;

  const trimmed = query.trim();
  const settled = !loading && results.query === trimmed;
  const patients = trimmed && results.query === trimmed ? results.patients : [];
  const queue = trimmed && results.query === trimmed ? results.queue : [];
  const actions = model.actions.filter((a) => !trimmed || matches(a.label, trimmed));
  const navigate = destinations.filter((d) => !trimmed || matches(d.label, trimmed));
  const values = [
    ...patients.map((p) => `patient:${p.id}`),
    ...queue.map((m) => `queue:${m.visitId}`),
    ...actions.map((a) => `action:${a.id}`),
    ...navigate.map((d) => `nav:${d.id}`),
  ];
  const value = userPicked && values.includes(active) ? active : (values[0] ?? "");
  const count = values.length;

  function reset() {
    seq.current++;
    if (timer.current) clearTimeout(timer.current);
    setQuery("");
    setResults(EMPTY);
    setLoading(false);
    setActive("");
    setUserPicked(false);
  }

  function search(next: string) {
    const n = ++seq.current;
    if (timer.current) clearTimeout(timer.current);
    const q = next.trim();
    if (!q) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const [p, m] = await Promise.all([
          canSearchPatients && q.length >= MIN_PATIENT_QUERY ? searchPatientsForPalette(q) : null,
          queueHref ? searchTodayQueueForPalette(q) : null,
        ]);
        if (n !== seq.current) return;
        setResults({ query: q, patients: p?.ok ? p.patients : [], queue: m?.ok ? m.matches : [] });
      } catch (err) {
        if (n !== seq.current) return;
        reportClientError("palette.search.failed", err);
        setResults({ query: q, patients: [], queue: [] });
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, PALETTE_DEBOUNCE_MS);
  }

  function go(href: string) {
    onOpenChange(false);
    reset();
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Search"
    >
      <Command
        label="Search"
        shouldFilter={false}
        value={value}
        onValueChange={setActive}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) setUserPicked(true);
        }}
        onPointerMove={() => setUserPicked(true)}
        data-command-palette=""
      >
        <CommandInput
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            setUserPicked(false);
            search(next);
          }}
          placeholder={PALETTE_PLACEHOLDER}
          aria-label={PALETTE_PLACEHOLDER}
          data-dirty-guard="ignore"
        />
        {loading && <CommandLoading label="Searching…" />}
        <CommandList label="Results">
          {settled && trimmed && count === 0 && (
            <CommandEmpty hint="Try a mobile number, token or name">{`No results for “${trimmed}”`}</CommandEmpty>
          )}
          {patients.length > 0 && (
            <CommandGroup heading="Patients">
              {patients.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`patient:${p.id}`}
                  multiline
                  hint={<span className="hidden in-data-[selected=true]:inline">Open</span>}
                  onSelect={() => go(`/patients/${p.id}`)}
                >
                  <PatientIdentityHeader
                    variant="inline"
                    patient={{ name: p.name, age: p.ageSex?.age ?? null, sex: p.ageSex?.sex ?? null, phone: p.phoneLast4 }}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {queue.length > 0 && queueHref && (
            <CommandGroup heading="Today queue">
              {queue.map((m) => (
                <CommandItem
                  key={m.visitId}
                  value={`queue:${m.visitId}`}
                  icon={<Hash />}
                  hint={<span className="hidden in-data-[selected=true]:inline">Open queue</span>}
                  onSelect={() => go(queueHref)}
                >
                  <span className="tabular-nums">{m.token !== null ? `Token ${m.token}` : "No token"}</span>
                  {" · "}
                  <span className="font-medium">{m.name}</span>
                  <span className="text-fg-muted">
                    {" · "}
                    {visitStatus(m.status).label}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {actions.length > 0 && (
            <CommandGroup heading="Actions">
              {actions.map((a: NavAction) => (
                <CommandItem key={a.id} value={`action:${a.id}`} icon={ACTION_ICON[a.id]} onSelect={() => go(a.href)}>
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {navigate.length > 0 && (
            <CommandGroup heading="Navigate">
              {navigate.map((d) => (
                <CommandItem key={d.id} value={`nav:${d.id}`} icon={<NavIcon icon={d.icon} />} onSelect={() => go(d.href)}>
                  {d.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <p role="status" className="sr-only" data-palette-count="">
          {trimmed && settled ? (count === 1 ? "1 result" : `${count} results`) : ""}
        </p>
      </Command>
    </CommandDialog>
  );
}
