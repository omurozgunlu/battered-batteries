import { HttpStatusCode } from "axios";

export const RETRY_POLICY = {
  maxAttempts: 4,
  requestTimeoutMs: 5_000,
  maxElapsedMs: 30_000,
  initialBackoffMs: 1_000,
  maxBackoffMs: 5_000,
};

export const RETRYABLE_STATUSES = new Set([
  HttpStatusCode.RequestTimeout,
  HttpStatusCode.TooManyRequests,
  HttpStatusCode.InternalServerError,
  HttpStatusCode.BadGateway,
  HttpStatusCode.ServiceUnavailable,
  HttpStatusCode.GatewayTimeout,
]);
export const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ERR_NETWORK",
]);
