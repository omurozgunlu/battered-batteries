import type { AxiosError, AxiosInstance } from "axios";
import axiosRetry, { retryAfter } from "axios-retry";
import {
  RETRY_POLICY,
  RETRYABLE_STATUSES,
  RETRYABLE_NETWORK_CODES,
} from "./constants";
import type { ApiRequest } from "./types";

export function configureRetries(http: AxiosInstance): void {
  axiosRetry(http, {
    retries: RETRY_POLICY.maxAttempts - 1,
    shouldResetTimeout: true,
    retryCondition: isRetryable,
    retryDelay: getRetryDelay,
  });
}

export function createRequestSignal(
  request: ApiRequest,
  nowMs: number,
): AbortSignal {
  // One deadline covers all HTTP attempts and retry delays, bounded by expiry.
  const lifetimeMs = Math.min(
    RETRY_POLICY.maxElapsedMs,
    request.data.endTime * 1_000 - nowMs,
  );
  return AbortSignal.timeout(lifetimeMs);
}

function isRetryable(error: AxiosError): boolean {
  if (error.config?.signal?.aborted) return false;
  if (error.response) return RETRYABLE_STATUSES.has(error.response.status);
  return RETRYABLE_NETWORK_CODES.has(error.code ?? "");
}

function getRetryDelay(retryCount: number, error: AxiosError): number {
  const backoffMs = Math.min(
    RETRY_POLICY.maxBackoffMs,
    axiosRetry.exponentialDelay(
      retryCount,
      undefined,
      RETRY_POLICY.initialBackoffMs / 2,
    ),
  );
  // Cap our backoff, but never shorten a server-requested Retry-After.
  return Math.max(backoffMs, retryAfter(error));
}
