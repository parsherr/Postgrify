/**
 * Query logging helper.
 * Logs every query when QUERY_LOG_ENABLED=true.
 * Queries exceeding SLOW_QUERY_THRESHOLD_MS are always logged as warnings.
 */

import { config } from "../config/env.js";

export interface QueryLogEntry {
  database: string;
  table?: string;
  sql?: string;
  durationMs: number;
  rowCount?: number;
  timestamp: string;
}

export function logQuery(
  logger: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void },
  entry: QueryLogEntry
): void {
  const isSlow = entry.durationMs >= config.SLOW_QUERY_THRESHOLD_MS;

  if (isSlow) {
    logger.warn(entry, `Slow query: ${entry.durationMs}ms on ${entry.database}`);
    return;
  }

  if (config.QUERY_LOG_ENABLED) {
    logger.info(entry, `Query: ${entry.database} ${entry.durationMs}ms`);
  }
}