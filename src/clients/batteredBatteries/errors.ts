import axios, { HttpStatusCode } from "axios";
import type { ApiRequest } from "./types";

export class BatteredBatteriesApiError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BatteredBatteriesApiError";
  }
}

export class SetpointRejectedError extends BatteredBatteriesApiError {
  override name = "SetpointRejectedError";
}

export class SetpointExpiredError extends Error {
  constructor(deviceId: string) {
    super(`Setpoint for ${deviceId} has no remaining valid start time.`);
    this.name = "SetpointExpiredError";
  }
}

export function rethrowRequestError(
  error: unknown,
  request: ApiRequest,
  signal: AbortSignal,
): never {
  const failure = axios.isAxiosError(error) ? error : undefined;
  const attempts = failure
    ? (failure.config?.["axios-retry"]?.retryCount ?? 0) + 1
    : 0;

  if (signal.aborted) {
    if (Date.now() >= request.data.endTime * 1_000) {
      throw new SetpointExpiredError(request.deviceId);
    }
    throw new BatteredBatteriesApiError(
      `Setpoint for ${request.deviceId} exceeded its time budget.`,
      attempts,
      undefined,
      "RETRY_BUDGET_EXCEEDED",
    );
  }
  if (!failure) throw error;

  // Raw Axios errors include request config containing the API key.
  const status = failure.response?.status;
  const rejected =
    status === HttpStatusCode.BadRequest ||
    status === HttpStatusCode.UnprocessableContent;
  const RequestError = rejected ? SetpointRejectedError : BatteredBatteriesApiError;
  throw new RequestError(
    `Setpoint request for ${request.deviceId} ${rejected ? "was rejected" : "failed"} (${
      status !== undefined
        ? `HTTP ${status}`
        : (failure.code ?? "request error")
    }).`,
    attempts,
    status,
    failure.code,
  );
}
