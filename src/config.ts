import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  GLOBAL_ALLOWED_ORIGINS: z.string().default("http://localhost:8080,http://127.0.0.1:8080"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_SIGNED_URL_ENDPOINT: z
    .string()
    .url()
    .default("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url"),
  BUBBLE_WORKFLOW_URL: z.string().url().optional(),
  BUBBLE_API_TOKEN: z.string().optional(),
  BUBBLE_ANALYTICS_URL: z.string().url().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW: z.string().default("1 minute")
});

export const config = envSchema.parse(process.env);

export const globalAllowedOrigins = config.GLOBAL_ALLOWED_ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
