/**
 * Content-Range helpers — PostgREST list pagination header.
 *
 * Format: Content-Range: {start}-{end}/{total or star}
 * HEAD/limit=0 empty window: star/{total or star}
 * Unit: items (Range-Unit: items)
 *
 * Ref: https://docs.postgrest.org/en/v12/references/api/pagination_count.html
 */

import type { FastifyReply } from "fastify";

export function setContentRange(
  reply: FastifyReply,
  offset: number,
  rowCount: number,
  total: number | null,
  opts?: { emptyStar?: boolean }
): void {
  const totalPart = total === null ? "*" : String(total);

  if (opts?.emptyStar || rowCount === 0) {
    // PostgREST limit=0 / empty: */N
    if (opts?.emptyStar || offset === 0) {
      reply.header("Content-Range", `*/${totalPart}`);
    } else {
      reply.header("Content-Range", `${offset}-${offset}/${totalPart}`);
    }
  } else {
    const start = offset;
    const end = offset + rowCount - 1;
    reply.header("Content-Range", `${start}-${end}/${totalPart}`);
  }

  reply.header("Range-Unit", "items");
  if (total !== null) {
    reply.header("X-Total-Count", String(total));
  }
}

/**
 * Parse HTTP Range header: `items=0-19` or bare `0-19`.
 * Returns null if absent/invalid.
 */
export function parseRangeHeader(
  range: string | undefined
): { offset: number; limit: number } | null {
  if (!range) return null;
  const cleaned = range.replace(/^items=/i, "").trim();
  const m = cleaned.match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return { offset: start, limit: end - start + 1 };
}
