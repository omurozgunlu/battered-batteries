import type { InvocationContext } from "@azure/functions";
import type { BatteredBatteriesClient } from "../clients/batteredBatteries";
import type { SetPoint } from "../types/setpoint";
import { isAllowedDevice } from "../constants/allowedDevices";

export class MessageProcessor {
  private readonly apiClient: BatteredBatteriesClient;

  constructor(apiClient: BatteredBatteriesClient) {
    this.apiClient = apiClient;
  }

  async processMessages(
    setpoints: SetPoint[],
    invocationContext: InvocationContext,
  ): Promise<void> {
    const allowedSetpoints = setpoints.filter((setpoint) =>
      isAllowedDevice(setpoint.device_id),
    );
    const latestSetpoints = this.latestPerDevice(allowedSetpoints);
  }

  private latestPerDevice(setpoints: SetPoint[]): SetPoint[] {
    const latestByDevice = new Map<SetPoint["device_id"], SetPoint>();
    for (const setpoint of setpoints) {
      const existing = latestByDevice.get(setpoint.device_id);
      if (!existing || existing.eventTime < setpoint.eventTime) {
        latestByDevice.set(setpoint.device_id, setpoint);
      }
    }
    return Array.from(latestByDevice.values());
  }

  private processMessage(setpoint: SetPoint) {}
}
