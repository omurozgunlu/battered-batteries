import type { InvocationContext } from "@azure/functions";
import type { BatteredBatteriesClient } from "../clients/batteredBatteries/client";
import type { SetPoint } from "../types/setpoint";
import { isAllowedDevice } from "../constants/allowedDevices";
import { toApiRequest } from "../mappers/toApi";
import { SetpointExpiredError } from "../clients/batteredBatteries/errors";

export class MessageProcessor {
  private readonly apiClient: BatteredBatteriesClient;
  private readonly timeOffset: number = 5_000;

  constructor(apiClient: BatteredBatteriesClient) {
    this.apiClient = apiClient;
  }

  async process(
    setpoints: SetPoint[],
    invocationContext: InvocationContext,
  ): Promise<void> {
    const allowedSetpoints = setpoints.filter((setpoint) =>
      isAllowedDevice(setpoint.deviceId),
    );

    const recentSetpoints = this.filterOutdated(allowedSetpoints);
    const latestSetpoints = this.latestPerDevice(recentSetpoints);

    const results = await Promise.allSettled(
      recentSetpoints.map(async (setpoint) => {
        const request = toApiRequest(setpoint, this.timeOffset);
        await this.apiClient.sendSetpoint(request);
      }),
    );

    const failures: unknown[] = [];

    results.forEach((result, idx) => {
      const deviceId = latestSetpoints[idx].deviceId;
      if (result.status === "fulfilled") {
        invocationContext.log(`Setpoint sent for ${deviceId}`);
        return;
      }
      if (result.reason instanceof SetpointExpiredError) {
        invocationContext.warn(`Setpoint expired for ${deviceId}`);
        return;
      }
      invocationContext.error(
        `Failed to send setpoint for ${deviceId}: ${result.reason}`,
      );
      failures.push(result.reason);

      if (failures.length > 0) {
        throw new Error(`Failed to send setpoints for devices: ${failures}`);
      }
    });
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
