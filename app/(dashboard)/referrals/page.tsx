import React from "react";
import { Metadata } from "next";
import { requirePermission } from "@/lib/permissions/guards";
import {
  getOutboundReferrals,
  getInboundReferrals,
} from "@/features/referrals/actions";
import { ReferralsRegister } from "@/components/referrals/referrals-register";

export const metadata: Metadata = {
  title: "Referrals Register | ClinicOS",
  description: "Manage outbound specialist referrals and inbound transfer records",
};

export default async function ReferralsPage() {
  await requirePermission("patients:view");

  const [outboundRes, inboundRes] = await Promise.all([
    getOutboundReferrals(),
    getInboundReferrals(),
  ]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      <ReferralsRegister
        initialOutbound={outboundRes.referrals || []}
        initialInbound={inboundRes.referrals || []}
      />
    </div>
  );
}
