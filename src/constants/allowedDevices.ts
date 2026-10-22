const ALLOWED_DEVICES = new Set([
  "BB00001",
  "BB00005",
  "BB00006",
  "BB00007",
  "BB00293",
]);

export const isAllowedDevice = (deviceId: string) =>
  ALLOWED_DEVICES.has(deviceId);
