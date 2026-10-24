export type ProcessResult =
  | { deviceId: string; status: "success" }
  | { deviceId: string; status: "expired" }
  | { deviceId: string; status: "rejected"; error: unknown }
  | { deviceId: string; status: "failed"; error: unknown };
