import { redirect } from "next/navigation";

export default function BillingRegisterRedirect() {
  redirect("/billing/reports");
}
