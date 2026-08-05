/**
 * Vitest global test setup — her test dosyasından önce çalışır.
 * Ortam değişkenlerini test değerleriyle override eder.
 */

process.env.PG_HOST = "localhost";
process.env.PG_PORT = "5432";
process.env.PG_USER = "postgres";
process.env.PG_PASSWORD = "test";
process.env.PG_SSL = "false";
process.env.JWT_SECRET = "test-secret-must-be-at-least-32-characters";
process.env.ADMIN_SECRET = "test-admin-secret-16ch";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.PORT = "3001";