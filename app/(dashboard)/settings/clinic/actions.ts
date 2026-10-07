"use server";

import { revalidatePath } from "next/cache";
import { updateClinicProfile } from "@/features/clinics/profile";

export async function updateClinicProfileAction(formData: FormData) {
  const name = formData.get("name") as string;
  const address = (formData.get("address") as string) || null;
  const timezone = (formData.get("timezone") as string) || "Asia/Kolkata";
  const specialties = formData.getAll("specialties") as string[];

  const result = await updateClinicProfile({
    name,
    address,
    timezone,
    specialties,
    working_hours: {},
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  revalidatePath("/settings/clinic");
}
