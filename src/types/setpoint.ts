export type SetPoint = {
  deviceId: string;
  value: number;
  unit: "kW";
  /** Unix timestamp in milliseconds. */
  endTime: number;
  /** Unix timestamp in milliseconds. */
  eventTime: number;
};
