/**
 * E-16: Parse PostgREST-style embed fragments in select=.
 *
 *   author:users(name,email)
 *   comments(body,created_at)
 *   items:order_items(*)
 *   author:users!author_id(name)
 *
 * Nested embeds (one level): comments(id,author:users(name))
 * Commas inside (...) are not top-level separators.
 */

import { isValidIdentifier } from "../utils/identifier.js";

export interface EmbedColumn {
  /** Plain column name, or nested embed */
  kind: "column" | "embed";
  name?: string;
  embed?: EmbedSpec;
}

export interface EmbedSpec {
  /** Response key */
  alias: string;
  /** Target table */
  table: string;
  /** Optional !hint (FK column or constraint name) */
  hint: string | null;
  /** Selected columns; empty + star means * */
  columns: EmbedColumn[];
  star: boolean;
}

export interface SelectToken {
  kind: "column" | "embed";
  /** Raw non-embed item (may include alias/agg/cast) */
  raw?: string;
  embed?: EmbedSpec;
}

/** Split on commas not inside parentheses. */
export function splitSelectTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) {
        throw new Error(`Unbalanced parentheses in select: ${input}`);
      }
    } else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  if (depth !== 0) {
    throw new Error(`Unbalanced parentheses in select: ${input}`);
  }
  parts.push(input.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

function findAliasColon(item: string): number {
  for (let i = 0; i < item.length; i++) {
    if (item[i] !== ":") continue;
    if (item[i + 1] === ":") {
      i += 1;
      continue;
    }
    // Don't treat colon inside (...) as alias separator for outer parse —
    // embeds are alias:table(...) so colon is before '('.
    return i;
  }
  return -1;
}

/**
 * Try to parse `alias:table!hint(cols)` or `table(cols)`.
 * Returns null if not an embed pattern.
 */
export function parseEmbedSpec(item: string): EmbedSpec | null {
  const s = item.trim();
  const open = s.indexOf("(");
  if (open === -1 || !s.endsWith(")")) return null;

  // Ensure matching close is the final char with balanced parens from open
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth += 1;
    else if (s[i] === ")") {
      depth -= 1;
      if (depth === 0 && i !== s.length - 1) return null;
    }
  }
  if (depth !== 0) return null;

  const head = s.slice(0, open);
  const inner = s.slice(open + 1, -1).trim();

  let alias: string | null = null;
  let tablePart = head;

  const colonIdx = findAliasColon(head);
  if (colonIdx !== -1) {
    alias = head.slice(0, colonIdx);
    tablePart = head.slice(colonIdx + 1);
    if (!alias || !isValidIdentifier(alias)) {
      throw new Error(`Invalid embed alias: ${alias ?? "(empty)"}`);
    }
  }

  let hint: string | null = null;
  let table = tablePart;
  const bang = tablePart.indexOf("!");
  if (bang !== -1) {
    table = tablePart.slice(0, bang);
    hint = tablePart.slice(bang + 1);
    if (!hint || !isValidIdentifier(hint)) {
      throw new Error(`Invalid embed hint: ${hint ?? "(empty)"}`);
    }
  }

  if (!table || !isValidIdentifier(table)) {
    // Likely not an embed (e.g. amount.sum() already handled elsewhere)
    return null;
  }

  // Aggregates look like amount.sum() — table would be amount, but .sum is invalid
  // tablePart for amount.sum is "amount.sum" which fails isValidIdentifier. Good.

  const responseAlias = alias ?? table;
  if (inner === "*") {
    return {
      alias: responseAlias,
      table,
      hint,
      columns: [],
      star: true,
    };
  }

  if (inner === "") {
    // `count()` is E-20 aggregate, not an embed of table "count".
    if (table === "count" && !hint) return null;
    throw new Error(
      `Empty embed select for "${table}". Use ${table}(*) or ${table}(col1,col2)`
    );
  }

  const colParts = splitSelectTopLevel(inner);
  const columns: EmbedColumn[] = [];
  for (const part of colParts) {
    if (part === "*") {
      throw new Error(
        `Cannot mix "*" with other columns inside embed ${table}(...)`
      );
    }
    const nested = parseEmbedSpec(part);
    if (nested) {
      columns.push({ kind: "embed", embed: nested });
      continue;
    }
    if (!isValidIdentifier(part)) {
      // Allow alias:col inside embed? Keep v1 simple — plain identifiers only
      // unless nested embed.
      const colon = findAliasColon(part);
      if (colon !== -1) {
        const a = part.slice(0, colon);
        const c = part.slice(colon + 1);
        if (isValidIdentifier(a) && isValidIdentifier(c)) {
          // Store as column with "alias:col" encoding via name? Better expand later.
          // For v1: reject aliases inside embed except nested embeds.
          throw new Error(
            `Column aliases inside embeds are not supported yet: ${part}`
          );
        }
      }
      throw new Error(`Invalid column in embed ${table}(...): ${part}`);
    }
    columns.push({ kind: "column", name: part });
  }

  return {
    alias: responseAlias,
    table,
    hint,
    columns,
    star: false,
  };
}

/**
 * Tokenize a full select= string into column raws + embeds.
 */
export function tokenizeSelect(select: string): SelectToken[] {
  const parts = splitSelectTopLevel(select);
  return parts.map((part) => {
    const embed = parseEmbedSpec(part);
    if (embed) return { kind: "embed" as const, embed };
    return { kind: "column" as const, raw: part };
  });
}
