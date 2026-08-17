/**
 * logQuery helper function tests.
 * Verifies slow-query warning and normal log behaviour.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { logQuery } from "../../src/utils/logger.js";

// Mock config so SLOW_QUERY_THRESHOLD_MS and QUERY_LOG_ENABLED are controllable
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
  it("logs a slow query (>= threshold) as warn", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 600 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
    const [obj, msg] = logger.warn.mock.calls[0];
    expect((obj as typeof baseEntry).durationMs).toBe(600);
    expect(msg).toContain("Slow query");
  });

  it("counts exactly threshold duration (500ms) as a slow query", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 500 });
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("does not log a normal query when QUERY_LOG_ENABLED=false", () => {
    const logger = makeLogger();
    logQuery(logger, { ...baseEntry, durationMs: 100 });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("includes the database name in the slow-query message", () => {
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

  it("logs a normal query as info when QUERY_LOG_ENABLED=true", async () => {
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