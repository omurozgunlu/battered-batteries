import axios, { type AxiosInstance } from "axios";
import * as z from "zod";
import { ApiRequestSchema, type ApiRequest } from "./batteredBatteries.types";

export type BatterySetpoint = Omit<ApiRequest["data"], "startTime">;

const BatterySetpointSchema = z.object({
  value: ApiRequestSchema.shape.data.shape.value,
  endTime: ApiRequestSchema.shape.data.shape.endTime
    .max(Math.floor(Number.MAX_SAFE_INTEGER / 1_000)),
});

export type BatteredBatteriesClientOptions = {
  apiKey?: string;
  baseURL?: string;
  requestTimeoutMs?: number;
  /** Includes the initial request. */
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  /** Includes time spent waiting behind other calls on this client. */
  maxElapsedMs?: number;
};

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

export class SetpointExpiredError extends Error {
  constructor(deviceId: string) {
    super(`Setpoint for ${deviceId} has no remaining valid start time.`);
    this.name = "SetpointExpiredError";
  }
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNABORTED",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ERR_NETWORK",
]);

export class BatteredBatteriesClient {
  private readonly http: AxiosInstance;
  private readonly policy: Required<
    Pick<
      BatteredBatteriesClientOptions,
      | "requestTimeoutMs"
      | "maxAttempts"
      | "initialBackoffMs"
      | "maxBackoffMs"
      | "maxElapsedMs"
    >
  >;
  private pending: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: BatteredBatteriesClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.BATTERED_BATTERIES_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error("BATTERED_BATTERIES_API_KEY must be configured.");
    }

    this.policy = {
      requestTimeoutMs: options.requestTimeoutMs ?? 5_000,
      maxAttempts: options.maxAttempts ?? 4,
      initialBackoffMs: options.initialBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 5_000,
      maxElapsedMs: options.maxElapsedMs ?? 30_000,
    };
    for (const [name, value] of Object.entries(this.policy)) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
        throw new RangeError(`${name} must be a positive 32-bit integer.`);
      }
    }
    if (this.policy.initialBackoffMs > this.policy.maxBackoffMs) {
      throw new RangeError("initialBackoffMs must not exceed maxBackoffMs.");
    }

    this.http = axios.create({
      baseURL:
        options.baseURL ??
        process.env.BATTERED_BATTERIES_API_URL ??
        "https://BatB.azure-api.net",
      headers: {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": apiKey,
      },
      // Only 204 means success according to the specification; it may have no body.
      validateStatus: (status) => status === 204,
      maxRedirects: 0,
    });
  }

  async sendSetpoint(
    deviceId: string,
    setpoint: BatterySetpoint,
  ): Promise<void> {
    if (!deviceId.trim() || deviceId === "." || deviceId === "..") {
      throw new TypeError("A device identifier is required.");
    }
    // Parsing validates and snapshots input before it enters the retry queue.
    const command = BatterySetpointSchema.parse(setpoint);
    const deadline = Date.now() + this.policy.maxElapsedMs;

    // Keep retries and newer commands in submission order within this instance.
    // Reuse one client per worker; separate instances do not share this queue/cooldown.
    const operation = this.pending.then(() =>
      this.sendWithRetry(deviceId, command, deadline),
    );
    this.pending = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async sendWithRetry(
    deviceId: string,
    setpoint: BatterySetpoint,
    deadline: number,
  ): Promise<void> {
    let lastError: BatteredBatteriesApiError | undefined;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      const retryAt = Math.max(Date.now(), this.nextRequestAt);
      if (Math.floor(retryAt / 1_000) + 1 >= setpoint.endTime) {
        throw new SetpointExpiredError(deviceId);
      }
      if (retryAt >= deadline) {
        throw (
          lastError ??
          new BatteredBatteriesApiError(
            `Setpoint for ${deviceId} exceeded its time budget before sending.`,
            attempt - 1,
            undefined,
            "RETRY_BUDGET_EXCEEDED",
          )
        );
      }
      const delayMs = retryAt - Date.now();
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      const now = Date.now();
      const startTime = Math.floor(now / 1_000) + 1;
      if (startTime >= setpoint.endTime) {
        throw new SetpointExpiredError(deviceId);
      }
      if (now >= deadline) {
        throw (
          lastError ??
          new BatteredBatteriesApiError(
            `Setpoint for ${deviceId} exceeded its time budget before sending.`,
            attempt - 1,
            undefined,
            "RETRY_BUDGET_EXCEEDED",
          )
        );
      }

      // Validate outside the transport catch so schema errors are not HTTP failures.
      const body: ApiRequest = ApiRequestSchema.parse({
        data: { startTime, endTime: setpoint.endTime, value: setpoint.value },
      });
      const timeoutMs = Math.min(
        this.policy.requestTimeoutMs,
        deadline - now,
        setpoint.endTime * 1_000 - now,
      );
      // AbortSignal bounds connection establishment as well as response waiting.
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        await this.http.post(
          `/${encodeURIComponent(deviceId)}/setpoint`,
          body,
          {
            timeout: timeoutMs,
            signal,
          },
        );
        return;
      } catch (error: unknown) {
        const axiosError = axios.isAxiosError(error) ? error : undefined;
        const status = axiosError?.response?.status;
        const code = axiosError?.code;
        const retryable =
          axiosError !== undefined &&
          (status !== undefined
            ? RETRYABLE_STATUSES.has(status)
            : signal.aborted || RETRYABLE_NETWORK_CODES.has(code ?? ""));

        // Do not expose Axios errors/config: they include the subscription key.
        lastError = new BatteredBatteriesApiError(
          `Setpoint request for ${deviceId} failed (${
            status !== undefined ? `HTTP ${status}` : (code ?? "request error")
          }).`,
          attempt,
          status,
          code,
        );
        if (!retryable) {
          throw lastError;
        }

        const cap = Math.min(
          this.policy.maxBackoffMs,
          this.policy.initialBackoffMs * 2 ** (attempt - 1),
        );
        // Equal jitter: wait between half and all of the exponential delay.
        const backoffMs = Math.ceil(cap * (0.5 + Math.random() / 2));
        const retryAfterMs = parseRetryAfter(
          axiosError?.response?.headers["retry-after"],
        );
        // Preserve server cooldown even if this call has exhausted its attempts.
        this.nextRequestAt = Date.now() + Math.max(backoffMs, retryAfterMs);
        if (attempt === this.policy.maxAttempts) {
          throw lastError;
        }
      }
    }
  }
}

function parseRetryAfter(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    return 0;
  }
  const text = String(value).trim();
  if (!text) {
    return 0;
  }
  const seconds = Number(text);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}
