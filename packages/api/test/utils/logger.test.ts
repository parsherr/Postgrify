/**
 * logQuery yardımcı fonksiyon testleri.
 * Yavaş sorgu uyarısı ve normal log davranışını kontrol eder.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { logQuery } from "../../src/utils/logger.js";

// Config'i mock'la: SLOW_QUERY_THRESHOLD_MS ve QUERY_LOG_ENABLED kontrol edebilmek için
vi.mock("../../src/config/env.js", () => ({
  config: {
    SLOW_QUERY_THRESHOLD_MS: 500,
    QUERY_LOG_ENABLED: false,
  },
}));

const makeLogger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
});

const baseEntry = {
  database: "testdb",
  table: "users",
  durationMs: 100,
  timestamp: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logQuery", () => {
  it("yavaş sorgu (>= threshold) warn olarak loglanır", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 600 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
    const [obj, msg] = logger.warn.mock.calls[0];
    expect((obj as typeof baseEntry).durationMs).toBe(600);
    expect(msg).toContain("Slow query");
  });

  it("eşik değerinde (tam 500ms) yavaş sorgu sayılır", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 500 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("QUERY_LOG_ENABLED=false iken normal sorgu loglanmaz", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 100 });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("yavaş sorgu mesajında DB adını içerir", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 1000, database: "mydb" });
    const [, msg] = logger.warn.mock.calls[0];
    expect(msg).toContain("mydb");
  });
});

describe("logQuery — QUERY_LOG_ENABLED=true", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("QUERY_LOG_ENABLED=true iken normal sorgu info olarak loglanır", async () => {
    vi.doMock("../../src/config/env.js", () => ({
      config: {
        SLOW_QUERY_THRESHOLD_MS: 500,
        QUERY_LOG_ENABLED: true,
      },
    }));
    const { logQuery: logQueryEnabled } = await import("../../src/utils/logger.js");
    const logger = makeLogger();
    logQueryEnabled(logger, { ...baseEntry, durationMs: 100 });
    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});