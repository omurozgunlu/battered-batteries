import * as z from "zod";

export const ApiRequestSchema = z.object({
  data: z
    .object({
      startTime: z.number().int().positive(),
      endTime: z.number().int().positive(),
      value: z.number().int(),
    })
    .refine((data) => data.endTime > data.startTime, {
      message: "endTime must be later than startTime.",
      path: ["endTime"],
    }),
});

export type ApiRequest = z.infer<typeof ApiRequestSchema>;
