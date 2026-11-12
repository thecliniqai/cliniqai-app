"use server";

import { resolveServiceContext } from "@/lib/auth/context";
import * as reportsService from "./reports-service";
import type { GetCollectionReportResult } from "./reports-service";

export type {
  CollectionReportPaymentItem,
  CollectionReportData,
  GetCollectionReportResult,
} from "./reports-service";

/**
 * Aggregates daily, weekly, or monthly collection reports for clinic owners and billers. Authenticates and checks
 * billing:view before reading any input; tenant from the session only (ADR-0005 D1).
 */
export async function getDailyCollectionReport(
  startDateStr: string,
  endDateStr: string
): Promise<GetCollectionReportResult> {
  const resolved = await resolveServiceContext("billing:view");
  if (!resolved.ok) return { success: false, error: resolved.error };
  return reportsService.getDailyCollectionReport(resolved.ctx, startDateStr, endDateStr);
}
