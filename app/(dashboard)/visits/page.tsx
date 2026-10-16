import React from "react";
import { getActiveMembership } from "@/lib/auth/tenant";
import {
  getClinicVisitsRegister,
  getActiveClinicDoctors,
} from "@/features/visits/actions";
import { DatePreset } from "@/features/visits/schema";
import { VisitsRegisterView } from "@/components/visits/visits-register-view";

interface VisitsPageProps {
  searchParams: Promise<{
    preset?: string;
    start?: string;
    end?: string;
    doctor?: string;
    status?: string;
    specialty?: string;
    search?: string;
    page?: string;
  }>;
}

export default async function VisitsPage(props: VisitsPageProps) {
  const searchParams = await props.searchParams;
  const membership = await getActiveMembership();

  const validPresets: DatePreset[] = [
    "today",
    "yesterday",
    "last_7_days",
    "this_month",
    "custom",
  ];

  const datePreset: DatePreset = validPresets.includes(searchParams.preset as DatePreset)
    ? (searchParams.preset as DatePreset)
    : "today";

  const currentPage = Math.max(1, parseInt(searchParams.page || "1", 10) || 1);
  const doctorId = searchParams.doctor || "all";
  const status = searchParams.status || "all";
  const specialty = searchParams.specialty || "all";
  const searchQuery = searchParams.search || "";
  const startDate = searchParams.start || null;
  const endDate = searchParams.end || null;

  const [registerResult, activeDoctors] = await Promise.all([
    getClinicVisitsRegister({
      datePreset,
      startDate,
      endDate,
      doctorId,
      status,
      specialty,
      searchQuery,
      page: currentPage,
      pageSize: 25,
    }),
    getActiveClinicDoctors(),
  ]);

  return (
    <VisitsRegisterView
      initialVisits={registerResult.visits}
      metrics={registerResult.metrics}
      totalCount={registerResult.totalCount}
      currentPage={registerResult.page}
      pageSize={registerResult.pageSize}
      totalPages={registerResult.totalPages}
      activeDoctors={activeDoctors}
      userRole={membership.role}
      currentFilters={{
        datePreset,
        startDate,
        endDate,
        doctorId,
        status,
        specialty,
        searchQuery,
      }}
    />
  );
}
