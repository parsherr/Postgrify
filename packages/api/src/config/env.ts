/**
 * Ortam değişkenlerini okur, doğrular ve tip-güvenli config nesnesi döner.
 * Eksik zorunlu değişken varsa başlangıçta hata fırlatır.
 */

import { z } from "zod";

const envSchema = z.object({
  // PostgreSQL
  PG_HOST: z.string().default("localhost"),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().default("postgres"),
  PG_PASSWORD: z.string(),
  PG_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Connection pool
  PG_MAX_POOL_SIZE: z.coerce.number().default(10),
  PG_POOL_IDLE_TIMEOUT: z.coerce.number().default(30_000),
  PG_POOL_MAX_LIFETIME: z.coerce.number().default(3_600_000),

  // Auth
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 chars"),
  ADMIN_SECRET: z.string().min(16, "ADMIN_SECRET must be at least 16 chars"),
  JWT_EXPIRY: z.string().default("24h"),

  // Rate limiting
  RATE_LIMIT_GLOBAL: z.coerce.number().default(1000),
  RATE_LIMIT_DB: z.coerce.number().default(500),
  RATE_LIMIT_ADMIN: z.coerce.number().default(200),

  // Redis (opsiyonel — yoksa in-memory cache devreye girer)
  REDIS_URL: z.string().optional(),

  // Sunucu
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  // Özellik bayrakları
  ALLOW_RAW_SQL_ADMIN: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  QUERY_LOG_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),
  SLOW_QUERY_THRESHOLD_MS: z.coerce.number().default(500),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌  Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;