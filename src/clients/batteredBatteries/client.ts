import axios, { type AxiosError, type AxiosInstance } from "axios";
import axiosRetry, { retryAfter } from "axios-retry";
import { BatteredBatteriesApiError, SetpointExpiredError } from "./errors";
import type { ApiRequest } from "./types";
import {
  RETRY_POLICY,
  RETRYABLE_STATUSES,
  RETRYABLE_NETWORK_CODES,
} from "./constants";
import { refreshSetpoint, validateRequest } from "./utils";

type BatteredBatteriesClientOptions = {
  apiKey: string;
  baseURL: string;
};

export class BatteredBatteriesClient {
  private readonly http: AxiosInstance;

  constructor(options: BatteredBatteriesClientOptions) {
    this.http = axios.create({
      baseURL: options.baseURL,
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": options.apiKey,
      },
      timeout: RETRY_POLICY.requestTimeoutMs,
      validateStatus: (status) => status === 204,
      maxRedirects: 0,
    });

    axiosRetry(this.http, {
      retries: RETRY_POLICY.maxAttempts - 1,
      shouldResetTimeout: true,
      retryCondition: isRetryable,
      retryDelay: getRetryDelay,
    });

    this.http.interceptors.request.use((config) => {
      const body: Pick<ApiRequest, "data"> =
        typeof config.data === "string" ? JSON.parse(config.data) : config.data;
      const deviceId = decodeURIComponent(config.url?.split("/")[1] ?? "");
      const request = refreshSetpoint(
        { deviceId, data: body.data },
        Date.now(),
      );
      config.data = JSON.stringify({ data: request.data });
      return config;
    });
  }

  async sendSetpoint(request: ApiRequest): Promise<void> {
    validateRequest(request);
    const nowMs = Date.now();
    const command = refreshSetpoint(request, nowMs);
    // One deadline covers HTTP attempts and retry delays.
    const lifetimeMs = Math.min(
      RETRY_POLICY.maxElapsedMs,
      command.data.endTime * 1_000 - nowMs,
    );
    const signal = AbortSignal.timeout(lifetimeMs);

    try {
      await this.http.post(
        `/${encodeURIComponent(command.deviceId)}/setpoint`,
        { data: command.data },
        { signal },
      );
    } catch (error: unknown) {
      const failure = axios.isAxiosError(error) ? error : undefined;
      const attempts = failure
        ? (failure.config?.["axios-retry"]?.retryCount ?? 0) + 1
        : 0;
      if (signal.aborted) {
        if (Date.now() >= command.data.endTime * 1_000) {
          throw new SetpointExpiredError(command.deviceId);
        }
        throw new BatteredBatteriesApiError(
          `Setpoint for ${command.deviceId} exceeded its time budget.`,
          attempts,
          undefined,
          "RETRY_BUDGET_EXCEEDED",
        );
      }
      if (!failure) throw error;

      // Raw Axios errors include request config containing the API key.
      const status = failure.response?.status;
      throw new BatteredBatteriesApiError(
        `Setpoint request for ${command.deviceId} failed (${
          status !== undefined
            ? `HTTP ${status}`
            : (failure.code ?? "request error")
        }).`,
        attempts,
        status,
        failure.code,
      );
    }
  }
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
  return Math.max(backoffMs, retryAfter(error));
}
