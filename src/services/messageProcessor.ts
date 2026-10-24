import type { BatteredBatteriesClient } from "../clients/batteredBatteries/client";
import type { SetPoint } from "../types/setpoint";
import { isAllowedDevice } from "../constants/allowedDevices";
import { toApiRequest } from "../mappers/toApi";
import {
  SetpointRejectedError,
  SetpointExpiredError,
} from "../clients/batteredBatteries/errors";
import { ProcessResult } from "./types";

export class MessageProcessor {
  private readonly apiClient: BatteredBatteriesClient;

  constructor(apiClient: BatteredBatteriesClient) {
    this.apiClient = apiClient;
  }

  async process(setpoints: SetPoint[]): Promise<ProcessResult[]> {
    const selectedSetpoints = this.selectSetpoints(setpoints);

    const results = await this.sendSetpoints(selectedSetpoints);
    return this.handleResults(selectedSetpoints, results);
  }

  private async sendSetpoints(
    setpoints: SetPoint[],
  ): Promise<PromiseSettledResult<void>[]> {
    return Promise.allSettled(
      setpoints.map(async (setpoint) => {
        await this.apiClient.sendSetpoint(toApiRequest(setpoint));
      }),
    );
  }

  private handleResults(
    setpoints: SetPoint[],
    results: PromiseSettledResult<void>[],
  ): ProcessResult[] {
    return results.map((result, index) => {
      const deviceId = setpoints[index].deviceId;
      if (result.status === "fulfilled") {
        return { deviceId, status: "success" };
      }
      const error = result.reason;
      if (error instanceof SetpointExpiredError) {
        return { deviceId, status: "expired" };
      }
      if (error instanceof SetpointRejectedError) {
        return { deviceId, status: "rejected", error };
      }

      return {
        deviceId,
        status: "failed",
        error: error,
      };
    });
  }

  private selectSetpoints(setpoints: SetPoint[]): SetPoint[] {
    const allowed = setpoints.filter((setpoint) =>
      isAllowedDevice(setpoint.deviceId),
    );
    const latest = this.latestPerDevice(allowed);
    return this.filterOutdated(latest);
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
}
