import axios, { type AxiosInstance } from "axios";
import { rethrowRequestError } from "./errors";
import { configureRetries, createRequestSignal } from "./retry";
import type { ApiRequest } from "./types";
import { RETRY_POLICY } from "./constants";
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

    configureRetries(this.http);

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
    const signal = createRequestSignal(command, nowMs);

    try {
      await this.http.post(
        `/${encodeURIComponent(command.deviceId)}/setpoint`,
        { data: command.data },
        { signal },
      );
    } catch (error: unknown) {
      rethrowRequestError(error, command, signal);
    }
  }
}
