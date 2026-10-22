import * as z from "zod";

export const SetPointMessageSchema = z.object({
  device_id: z.string().min(1),
  setpoint: z.object({
    value: z.number(),
    unit: z.literal("kW"),
    endTime: z.iso.datetime(),
  }),
  eventTime: z.iso.datetime(),
});

export type SetPointMessage = z.infer<typeof SetPointMessageSchema>;
