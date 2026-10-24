import z from "zod";

const envSchema = z.object({
  BATTERED_BATTERIES_API_URL: z.string().min(1),
  BATTERED_BATTERIES_API_KEY: z.string().min(1),
});

export const loadConfig = () => envSchema.parse(process.env);

export type ServiceEnv = z.infer<typeof envSchema>;
