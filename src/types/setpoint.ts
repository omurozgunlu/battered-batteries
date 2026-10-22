export type SetPoint = {
  device_id: string;
  value: number;
  unit: "kW";
  /** Unix timestamp in milliseconds. */
  endTime: number;
  /** Unix timestamp in milliseconds. */
  eventTime: number;
};
