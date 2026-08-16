/**
 * Prefer header parser — PostgREST-compatible preference tokens.
 *
 * Examples:
 *   Prefer: return=representation
 *   Prefer: count=exact
 *   Prefer: resolution=merge-duplicates, return=minimal
 *   Prefer: missing=default
 */

export type PreferReturn = "minimal" | "representation" | "headers-only";
export type PreferCount = "exact" | "planned" | "estimated" | null;
export type PreferResolution = "merge-duplicates" | "ignore-duplicates" | null;
export type PreferMissing = "default" | "null" | null;

export interface PreferOptions {
  return: PreferReturn;
  count: PreferCount;
  resolution: PreferResolution;
  missing: PreferMissing;
}

const DEFAULTS: PreferOptions = {
  return: "minimal",
  count: null,
  resolution: null,
  missing: null,
};

/**
 * Parse a Prefer header value into structured options.
 * Unknown tokens are ignored (PostgREST behavior).
 */
export function parsePrefer(header: string | string[] | undefined): PreferOptions {
  const result: PreferOptions = { ...DEFAULTS };
  if (!header) return result;

  const raw = Array.isArray(header) ? header.join(",") : header;
  const tokens = raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    const key = token.slice(0, eq).trim();
    const value = token.slice(eq + 1).trim();

    if (key === "return") {
      if (value === "minimal" || value === "representation" || value === "headers-only") {
        result.return = value;
      }
    } else if (key === "count") {
      if (value === "exact" || value === "planned" || value === "estimated") {
        result.count = value;
      }
    } else if (key === "resolution") {
      if (value === "merge-duplicates" || value === "ignore-duplicates") {
        result.resolution = value;
      }
    } else if (key === "missing") {
      if (value === "default" || value === "null") {
        result.missing = value;
      }
    }
  }

  return result;
}
