import type { ApiRequest } from "../clients/batteredBatteries/types";
import type { SetPoint } from "../types/setpoint";

export function toApiRequest(
  setpoint: SetPoint,
  timeOffsetMs: number,
): ApiRequest {
  return {
    deviceId: setpoint.deviceId,
    data: {
      startTime: Math.floor((Date.now() + timeOffsetMs) / 1_000) + 1,
      endTime: Math.floor(setpoint.endTime / 1_000),
      value: Math.round(-setpoint.value * 1_000),
    },
  };
}
