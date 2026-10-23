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
