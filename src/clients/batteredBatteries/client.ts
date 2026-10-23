import axios, { type AxiosError, type AxiosInstance } from "axios";
import { BatteredBatteriesApiError, SetpointExpiredError } from "./errors";
import type { ApiRequest } from "./types";
import {
  RETRY_POLICY,
  RETRYABLE_STATUSES,
  RETRYABLE_NETWORK_CODES,
} from "./constants";

export type BatteredBatteriesClientOptions = {
  apiKey: string;
  baseURL: string;
};

export class BatteredBatteriesClient {
  private readonly http: AxiosInstance;
  private pending: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: BatteredBatteriesClientOptions) {
    this.http = axios.create({
      baseURL: options.baseURL,
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": options.apiKey,
      },
      validateStatus: (status) => status === 204,
      maxRedirects: 0,
    });
  }

  async sendSetpoint(request: ApiRequest): Promise<void> {
    validateRequest(request);
    const command: ApiRequest = {
      deviceId: request.deviceId,
      data: { ...request.data },
    };
    const deadline = Date.now() + RETRY_POLICY.maxElapsedMs;

    // Serialize calls, including retries, so newer submissions cannot overtake old ones.
    const operation = this.pending.then(() =>
      this.sendWithRetry(command, deadline),
    );
    this.pending = operation.catch(() => {}); // A failed call must not block the queue.
    return operation;
  }

  private async sendWithRetry(
    request: ApiRequest,
    deadline: number,
  ): Promise<void> {
    for (let attempt = 1; attempt <= RETRY_POLICY.maxAttempts; attempt++) {
      const retryAt = Math.max(Date.now(), this.nextRequestAt);
      // Fail immediately if the server cooldown leaves no time to send the command.
      prepareAttempt(request, retryAt, deadline, attempt - 1);
      const delayMs = retryAt - Date.now();
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      const { data, timeoutMs } = prepareAttempt(
        request,
        Date.now(),
        deadline,
        attempt - 1,
      );
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        // deviceId belongs in the URL, not the JSON body.
        await this.http.post(
          `/${encodeURIComponent(request.deviceId)}/setpoint`,
          { data },
          {
            timeout: timeoutMs,
            signal,
          },
        );
        return;
      } catch (error: unknown) {
        const failure = axios.isAxiosError(error) ? error : undefined;
        const status = failure?.response?.status;
        // Raw Axios errors contain request config, including the API key.
        const apiError = new BatteredBatteriesApiError(
          `Setpoint request for ${request.deviceId} failed (${
            status !== undefined
              ? `HTTP ${status}`
              : (failure?.code ?? "request error")
          }).`,
          attempt,
          status,
          failure?.code,
        );
        if (!isRetryable(failure, signal.aborted)) {
          throw apiError;
        }

        const backoffCap = Math.min(
          RETRY_POLICY.maxBackoffMs,
          RETRY_POLICY.initialBackoffMs * 2 ** (attempt - 1),
        );
        const backoffMs = Math.ceil(backoffCap * (0.5 + Math.random() / 2));
        const retryAfterMs = parseRetryAfter(
          failure?.response?.headers["retry-after"],
        );
        // Keep this cooldown for the next queued call even if attempts are exhausted.
        this.nextRequestAt = Date.now() + Math.max(backoffMs, retryAfterMs);
        if (attempt === RETRY_POLICY.maxAttempts) {
          throw apiError;
        }
      }
    }
  }
}

function validateRequest({ data }: ApiRequest): void {
  if (data.endTime <= data.startTime) {
    throw new TypeError("Setpoint endTime must be later than startTime.");
  }
}

function prepareAttempt(
  request: ApiRequest,
  now: number,
  deadline: number,
  attempts: number,
) {
  const data = {
    ...request.data,
    // Keep the requested start unless queueing or retries have made it stale.
    startTime: Math.max(request.data.startTime, Math.floor(now / 1_000) + 1),
  };
  if (data.startTime >= data.endTime) {
    throw new SetpointExpiredError(request.deviceId);
  }
  const timeoutMs = Math.min(
    RETRY_POLICY.requestTimeoutMs,
    deadline - now,
    data.endTime * 1_000 - now,
  );
  if (timeoutMs <= 0) {
    throw new BatteredBatteriesApiError(
      `Setpoint for ${request.deviceId} exceeded its time budget.`,
      attempts,
      undefined,
      "RETRY_BUDGET_EXCEEDED",
    );
  }
  return { data, timeoutMs };
}

function isRetryable(
  error: AxiosError | undefined,
  timedOut: boolean,
): boolean {
  if (!error) return false;
  if (error.response) return RETRYABLE_STATUSES.has(error.response.status);
  return timedOut || RETRYABLE_NETWORK_CODES.has(error.code ?? "");
}

function parseRetryAfter(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const text = String(value).trim();
  if (!text) return 0;

  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
