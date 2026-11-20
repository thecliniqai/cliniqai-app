import type { QuickRegisterValues } from "@/components/clinical/quick-register-form";
import type { NewPatientInput } from "./schema";

const SEX: Record<QuickRegisterValues["sex"], "male" | "female" | "other"> = { M: "male", F: "female", O: "other" };

/**
 * What `QuickRegisterForm` collected, as the input of `registerPatient` (V2-08 08-02, R-12). The date of birth is always sent:
 * a typed date as is; for a typed age the form has already derived it with the server's convention (1 January of the birth
 * year from 2 years up; an exact date for an infant, whose age is entered in months), so the stored date is the same either
 * way and the schema derives the age from it. The AI objection is a plain boolean.
 */
export function quickRegisterToPatientInput(values: QuickRegisterValues): NewPatientInput {
  return {
    full_name: values.name,
    phone: values.phone,
    date_of_birth: values.dob,
    sex: SEX[values.sex],
    ai_processing_objected: values.aiObjected,
  };
}
