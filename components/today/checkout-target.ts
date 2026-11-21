import type { CheckoutTarget } from "@/components/queue/checkout-drawer";
import type { TodayRow } from "@/features/today/schema";

const SEX: Record<string, string> = { M: "male", F: "female", O: "other" };

/** A Today row as the checkout drawer's visit (`Collect` on a To-bill row opens the existing drawer; V2-10 replaces it). */
export function toCheckoutTarget(row: TodayRow): CheckoutTarget {
  const years = /^(\d+) y$/.exec(row.age ?? "");
  return {
    visit: { id: row.visitId, status: row.status },
    patient: {
      id: row.patientId,
      full_name: row.name,
      sex: row.sex ? (SEX[row.sex] ?? null) : null,
      age: years ? Number(years[1]) : null,
      phone: row.phone,
    },
    queueToken: row.token != null ? { token_number: row.token } : null,
    doctorName: row.doctorName,
  };
}
