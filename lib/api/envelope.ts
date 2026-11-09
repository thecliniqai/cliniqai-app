import { NextResponse } from "next/server";
import crypto from "crypto";

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    correlation_id?: string;
  };
}

/**
 * Uniform success response envelope: { data: T, meta?: Record<string, unknown> }
 * Complies with AGENTS.md §11, D-03, and Phase 06 contract.
 */
export function apiSuccess<T>(
  data: T,
  meta?: Record<string, unknown>,
  status: number = 200,
  headers?: HeadersInit
): NextResponse<ApiSuccessResponse<T>> {
  const body: ApiSuccessResponse<T> = { data };
  if (meta && Object.keys(meta).length > 0) {
    body.meta = meta;
  }
  return NextResponse.json(body, { status, headers });
}

/**
 * Uniform error response envelope: { error: { code, message, details?, correlation_id? } }
 * Sanitises internal database errors per AGENTS.md §12.
 */
export function apiError(
  code: string,
  message: string,
  status: number = 400,
  details?: unknown,
  headers?: HeadersInit
): NextResponse<ApiErrorResponse> {
  const correlationId = crypto.randomUUID();
  let sanitizedMessage = message;
  let sanitizedDetails = details;

  // Sanitize 5xx and internal database errors to prevent leaking schema or SQL errors
  if (status >= 500 || code === "DATABASE_ERROR" || code === "INTERNAL_ERROR") {
    console.error(`[api-v1] Error ${correlationId} [${code}]:`, message, details);
    sanitizedMessage = "An internal database error occurred.";
    sanitizedDetails = undefined;
  }

  const responseBody: ApiErrorResponse = {
    error: {
      code,
      message: sanitizedMessage,
      ...(sanitizedDetails !== undefined ? { details: sanitizedDetails } : {}),
      ...(status >= 500 || code === "DATABASE_ERROR" ? { correlation_id: correlationId } : {}),
    },
  };

  return NextResponse.json(responseBody, { status, headers });
}
