/**
 * Minimal CSV serializer for Accept: text/csv list responses (E-23).
 */

export function rowsToCsv(
  rows: Record<string, unknown>[],
  columns?: string[]
): string {
  const cols =
    columns && columns.length > 0
      ? columns
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];
  if (cols.length === 0) return "";

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s =
      v instanceof Date
        ? v.toISOString()
        : typeof v === "object"
          ? JSON.stringify(v)
          : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = cols.join(",");
  const lines = rows.map((row) => cols.map((c) => escape(row[c])).join(","));
  return [header, ...lines].join("\n");
}

/** True when Accept prefers text/csv (PostgREST-compatible). */
export function wantsCsv(accept: string | undefined): boolean {
  if (!accept) return false;
  const lower = accept.toLowerCase();
  // Prefer explicit csv over */* or application/json
  if (lower.includes("text/csv")) return true;
  return false;
}
