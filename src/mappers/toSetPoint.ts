import type { SetPointMessage } from "../types/dto/setpointMessage";
import type { SetPoint } from "../types/setpoint";

export function toSetPoint(message: SetPointMessage): SetPoint {
  return {
    device_id: message.device_id,
    value: message.setpoint.value,
    unit: "kW",
    endTime: Date.parse(message.setpoint.endTime),
    eventTime: Date.parse(message.eventTime),
  };
}
