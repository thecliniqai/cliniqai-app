import { DayAvailability, DayOfWeek } from "@/lib/db/types";

export const DAY_OF_WEEK_NAMES: DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function timeToMinutes(timeHHMM: string): number {
  if (!timeHHMM) return 0;
  const [h, m] = timeHHMM.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function isSlotWithinShifts(
  slotTimeHHMM: string,
  durationMinutes: number,
  dayAvailability?: DayAvailability | null
): boolean {
  if (!dayAvailability || !dayAvailability.enabled || !dayAvailability.shifts || dayAvailability.shifts.length === 0) {
    return false;
  }
  const slotStart = timeToMinutes(slotTimeHHMM);
  const slotEnd = slotStart + durationMinutes;

  for (const shift of dayAvailability.shifts) {
    const shiftStart = timeToMinutes(shift.start);
    const shiftEnd = timeToMinutes(shift.end);
    if (slotStart >= shiftStart && slotEnd <= shiftEnd) {
      return true;
    }
  }
  return false;
}

export function getTimePartsFromISO(
  isoString: string,
  timeZone: string = "Asia/Kolkata"
): { timeHHMM: string; dateStr: string; dayOfWeek: DayOfWeek } {
  const date = new Date(isoString);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value || "00";
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  const weekday = (parts.find((p) => p.type === "weekday")?.value || "Monday").toLowerCase() as DayOfWeek;

  const y = parts.find((p) => p.type === "year")?.value || "1970";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  const d = parts.find((p) => p.type === "day")?.value || "01";
  const dateStr = `${y}-${m}-${d}`;

  return { timeHHMM: `${hour}:${minute}`, dateStr, dayOfWeek: weekday };
}
