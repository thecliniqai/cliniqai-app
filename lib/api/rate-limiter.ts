export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number; // Unix epoch in seconds
}

/**
 * In-memory sliding window rate limiter (D-19, STRIDE T-06-03).
 * Tracks request timestamps per apiKeyId with automatic window cleanup.
 */
const rateLimitMap = new Map<string, number[]>();

export function checkRateLimit(
  apiKeyId: string,
  limit: number = 120,
  windowMs: number = 60000
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  const timestamps = rateLimitMap.get(apiKeyId) || [];
  // Filter out timestamps outside the sliding window
  const activeTimestamps = timestamps.filter((ts) => ts > windowStart);

  if (activeTimestamps.length >= limit) {
    const oldestTimestamp = activeTimestamps[0] || now;
    const resetTime = Math.ceil((oldestTimestamp + windowMs) / 1000);
    rateLimitMap.set(apiKeyId, activeTimestamps);

    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime,
    };
  }

  activeTimestamps.push(now);
  rateLimitMap.set(apiKeyId, activeTimestamps);

  const resetTime = Math.ceil((now + windowMs) / 1000);
  return {
    allowed: true,
    limit,
    remaining: limit - activeTimestamps.length,
    resetTime,
  };
}

/**
 * Returns standard rate-limit headers for /api/v1/* responses.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(result.resetTime),
  };
}

/**
 * Helper to clear rate limit state (primarily for automated testing).
 */
export function resetRateLimits(): void {
  rateLimitMap.clear();
}
