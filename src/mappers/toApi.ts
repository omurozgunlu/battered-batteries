import type { ApiRequest } from "../clients/batteredBatteries/types";
import { SetpointExpiredError } from "../clients/batteredBatteries/errors";
import type { SetPoint } from "../types/setpoint";

export function toApiRequest(setpoint: SetPoint): ApiRequest {
  const startTime = Math.floor(Date.now() / 1_000) + 1;
  const endTime = Math.floor(setpoint.endTime / 1_000);
  // Rounding can leave no valid interval even before the original end time.
  if (startTime >= endTime) {
    throw new SetpointExpiredError(setpoint.deviceId);
  }

  return {
    deviceId: setpoint.deviceId,
    data: {
      startTime,
      endTime,
      value: Math.round(-setpoint.value * 1_000),
    },
  };
}
