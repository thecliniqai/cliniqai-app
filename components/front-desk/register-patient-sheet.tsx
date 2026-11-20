"use client";

import { useRouter } from "next/navigation";
import { QuickRegisterForm, type DuplicateMatch, type QuickRegisterValues } from "@/components/clinical/quick-register-form";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
} from "@/components/ui/responsive-sheet";
import { registerPatient } from "@/features/patients/actions";
import { quickRegisterToPatientInput } from "@/features/patients/register-input";
import { saveStatusProps } from "@/lib/commands/save-state";
import { useCommand } from "@/lib/commands/use-command";
import { useDuplicateLookup } from "./use-duplicate-lookup";

/**
 * RegisterPatientSheet (V2-08 08-02, R-6, R-12, R-13): the one way to register a patient. `QuickRegisterForm` inside a
 * `ResponsiveSheet` (the bottom drawer on a phone, the side sheet from 768 px), `registerPatient` through `useCommand`
 * (one `client_request_id` per submit, a 15 s timeout, one automatic retry, SaveStatus with Retry). On success the patient's
 * profile opens (or the caller's `onRegistered` runs: the walk-in and booking sheets continue with the new patient).
 * "Use this patient" on a duplicate candidate opens that patient instead.
 */
export interface RegisterPatientSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultValues?: { phone?: string; name?: string };
  /** Defaults to opening the new patient's profile. */
  onRegistered?: (patientId: string) => void;
}

export function RegisterPatientSheet({ open, onOpenChange, defaultValues, onRegistered }: RegisterPatientSheetProps) {
  const router = useRouter();
  const command = useCommand();
  const findDuplicates = useDuplicateLookup();

  const submit = async (values: QuickRegisterValues) => {
    const result = await command.run((requestId) => registerPatient(quickRegisterToPatientInput(values), requestId));
    if (result.ok) {
      if (onRegistered) onRegistered(result.value.patientId);
      else {
        onOpenChange(false);
        router.push(`/patients/${result.value.patientId}`);
      }
    }
    return result;
  };

  const useExisting = (match: DuplicateMatch) => {
    onOpenChange(false);
    router.push(`/patients/${match.id}`);
  };

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange}>
      <ResponsiveSheetContent data-register-patient-sheet="" aria-describedby={undefined}>
        <ResponsiveSheetHeader title="Register patient" />
        <ResponsiveSheetBody>
          <QuickRegisterForm
            onSubmit={submit}
            findDuplicates={findDuplicates}
            onUseExisting={useExisting}
            onEdit={command.reset}
            saveStatus={saveStatusProps(command)}
            defaultValues={defaultValues}
          />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
