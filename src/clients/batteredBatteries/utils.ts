import { SetpointExpiredError } from "./errors";
import type { ApiRequest } from "./types";

export function refreshSetpoint(
  request: ApiRequest,
  nowMs: number,
): ApiRequest {
  const startTime = Math.max(
    request.data.startTime,
    Math.floor(nowMs / 1_000) + 1,
  );
  if (startTime >= request.data.endTime) {
    throw new SetpointExpiredError(request.deviceId);
  }

  return {
    deviceId: request.deviceId,
    data: { ...request.data, startTime },
  };
}

export function validateRequest({ data }: ApiRequest): void {
  if (
    !Number.isSafeInteger(data.startTime) ||
    !Number.isSafeInteger(data.endTime) ||
    !Number.isSafeInteger(data.value)
  ) {
    throw new TypeError(
      "Setpoint startTime, endTime, and value must be safe integers.",
    );
  }
  if (data.endTime <= data.startTime) {
    throw new TypeError("Setpoint endTime must be later than startTime.");
  }
}
