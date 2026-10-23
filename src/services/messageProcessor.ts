import type { InvocationContext } from "@azure/functions";
import type { BatteredBatteriesClient } from "../clients/batteredBatteries/client";
import type { SetPoint } from "../types/setpoint";
import { isAllowedDevice } from "../constants/allowedDevices";
import { toApiRequest } from "../mappers/toApi";

export class MessageProcessor {
  private readonly apiClient: BatteredBatteriesClient;
  private readonly timeOffset: number = 5_000;

  constructor(apiClient: BatteredBatteriesClient) {
    this.apiClient = apiClient;
  }

  async processMessages(
    setpoints: SetPoint[],
    invocationContext: InvocationContext,
  ): Promise<void> {
    const allowedSetpoints = setpoints.filter((setpoint) =>
      isAllowedDevice(setpoint.deviceId),
    );
    const latestSetpoints = this.latestPerDevice(allowedSetpoints);
    const recentSetpoints = this.filterOutdated(latestSetpoints);
    const apiPayload = recentSetpoints.map((setpoint) =>
      toApiRequest(setpoint, this.timeOffset),
    );
  }

  private latestPerDevice(setpoints: SetPoint[]): SetPoint[] {
    const latestByDevice = new Map<SetPoint["deviceId"], SetPoint>();
    for (const setpoint of setpoints) {
      const existing = latestByDevice.get(setpoint.deviceId);
      if (!existing || existing.eventTime < setpoint.eventTime) {
        latestByDevice.set(setpoint.deviceId, setpoint);
      }
    }
    return Array.from(latestByDevice.values());
  }

  private filterOutdated(setpoints: SetPoint[]): SetPoint[] {
    const currentTime = Date.now();
    return setpoints.filter((setpoint) => setpoint.endTime > currentTime);
  }

  private processMessage(setpoint: SetPoint) {}
}
