/**
 * Ortam değişkenlerini okur, doğrular ve tip-güvenli config nesnesi döner.
 * Eksik zorunlu değişken varsa başlangıçta hata fırlatır.
 */

import { z } from "zod";

const envSchema = z.object({
  // PostgreSQL
  PG_HOST: z.string().default("localhost"),
  PG_PORT: z.coerce.number().default(5432),
  PG_USER: z.string().default("postgrify"),
  PG_PASSWORD: z.string().default(""),
  PG_SSL: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Connection pool
  PG_MAX_POOL_SIZE: z.coerce.number().default(10),
  PG_POOL_IDLE_TIMEOUT: z.coerce.number().default(120_000),
  PG_POOL_MAX_LIFETIME: z.coerce.number().default(3_600_000),

  // Auth — production'da gerçek değer zorunlu; development'ta placeholder kabul edilir
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").default("placeholder-will-be-replaced-by-setup-wizard-32x"),
  ADMIN_SECRET: z.string().min(16, "ADMIN_SECRET must be at least 16 characters").default("placeholder-setup-16x"),
  JWT_EXPIRY: z.string().default("24h"),

  // Admin kullanıcı kimlik bilgileri (GUI login için)
  ADMIN_EMAIL: z.string().email("ADMIN_EMAIL must be a valid email").optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(), // argon2id hash — scripts/hash-password.ts ile üret
  ACCESS_TOKEN_EXPIRY: z.string().default("15m"),
  REFRESH_TOKEN_EXPIRY: z.string().default("7d"),

  // Rate limiting
  RATE_LIMIT_GLOBAL: z.coerce.number().default(1000),
  RATE_LIMIT_DB: z.coerce.number().default(500),
  RATE_LIMIT_ADMIN: z.coerce.number().default(200),

  // Redis (opsiyonel — yoksa in-memory cache devreye girer)
  REDIS_URL: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),

  // Terminal WebSocket — production'da açıkça true yapılmalı
  TERMINAL_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Sunucu
  PORT: z.coerce.number().default(6880),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),

  // SMTP (magic link, email verify, şifre sıfırlama için)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("noreply@postgrify.local"),
  SMTP_SECURE: z.string().transform((v) => v === "true").default("false"),

  // Genel uygulama URL'i (email linklerinde kullanılır)
  APP_URL: z.string().default("http://localhost:5173"),

  // Backup
  BACKUP_DIR: z.string().default("/data/backups"),
  BACKUP_MAX_SIZE_MB: z.coerce.number().default(500),

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

// Production'da bilinen placeholder secret'larla çalışmayı reddet.
// Bu değerler herkesçe bilindiği için geçerli token üretmek trivial hale gelir.
const KNOWN_PLACEHOLDER_JWT_SECRETS = new Set([
  "placeholder-will-be-replaced-by-setup-wizard-32x",
]);
const KNOWN_PLACEHOLDER_ADMIN_SECRETS = new Set([
  "placeholder-setup-16x",
]);

if (parsed.data.NODE_ENV === "production") {
  if (KNOWN_PLACEHOLDER_JWT_SECRETS.has(parsed.data.JWT_SECRET)) {
    console.error("❌  SECURITY: JWT_SECRET is set to a known placeholder value in production.");
    console.error("   Set a cryptographically random JWT_SECRET of at least 32 characters.");
    process.exit(1);
  }
  if (KNOWN_PLACEHOLDER_ADMIN_SECRETS.has(parsed.data.ADMIN_SECRET)) {
    console.error("❌  SECURITY: ADMIN_SECRET is set to a known placeholder value in production.");
    console.error("   Set a cryptographically random ADMIN_SECRET of at least 16 characters.");
    process.exit(1);
  }
  if (!parsed.data.PG_PASSWORD) {
    console.error("❌  SECURITY: PG_PASSWORD must not be empty in production.");
    process.exit(1);
  }
}

export const config = parsed.data;
export type Config = typeof config;