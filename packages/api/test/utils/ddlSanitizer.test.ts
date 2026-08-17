/**
 * ddlSanitizer unit tests.
 * Verifies the allowlist and injection protection of
 * assertColumnType and assertColumnDefault.
 */

import { describe, it, expect } from "vitest";
import {
  assertColumnType,
  assertColumnDefault,
} from "../../src/utils/ddlSanitizer.js";

// ---------------------------------------------------------------------------
// assertColumnType
// ---------------------------------------------------------------------------

describe("assertColumnType", () => {
  describe("valid types", () => {
    const validTypes = [
      "TEXT",
      "INTEGER",
      "BIGINT",
      "SMALLINT",
      "BOOLEAN",
      "JSONB",
      "JSON",
      "UUID",
      "SERIAL",
      "BIGSERIAL",
      "TIMESTAMP",
      "TIMESTAMPTZ",
      "DATE",
      "NUMERIC",
      "REAL",
      "FLOAT",
      "BYTEA",
      "INET",
    ];

    for (const type of validTypes) {
      it(`'${type}' passes`, () => {
        expect(() => assertColumnType(type, "col")).not.toThrow();
      });
    }

    it("lowercase 'text' is normalized to uppercase and passes", () => {
      expect(() => assertColumnType("text", "col")).not.toThrow();
      expect(assertColumnType("text", "col")).toBe("TEXT");
    });

    it("'VARCHAR(255)' with parentheses is normalized and passes", () => {
      expect(() => assertColumnType("VARCHAR(255)", "col")).not.toThrow();
    });

    it("'NUMERIC(10,2)' passes", () => {
      expect(() => assertColumnType("NUMERIC(10,2)", "col")).not.toThrow();
    });

    it("'character varying' passes", () => {
      expect(() => assertColumnType("character varying", "col")).not.toThrow();
    });
  });

  describe("invalid types / injection attempts", () => {
    it("'VOID' is rejected", () => {
      expect(() => assertColumnType("VOID", "col")).toThrow();
    });

    it("'FUNCTION' is rejected", () => {
      expect(() => assertColumnType("FUNCTION", "col")).toThrow();
    });

    it("'BYTECODE' is rejected", () => {
      expect(() => assertColumnType("BYTECODE", "col")).toThrow();
    });

    it("empty string is rejected", () => {
      expect(() => assertColumnType("", "col")).toThrow();
    });

    it("whitespace-only string is rejected", () => {
      expect(() => assertColumnType("   ", "col")).toThrow();
    });

    it("'TEXT; DROP TABLE users' injection is rejected", () => {
      expect(() => assertColumnType("TEXT; DROP TABLE users", "col")).toThrow();
    });

    it("'TEXT REFERENCES other(id)' is rejected", () => {
      expect(() => assertColumnType("TEXT REFERENCES other(id)", "col")).toThrow();
    });

    it("error message includes the column name", () => {
      expect(() => assertColumnType("VOID", "my_column")).toThrow(/my_column/);
    });
  });
});

// ---------------------------------------------------------------------------
// assertColumnDefault
// ---------------------------------------------------------------------------

describe("assertColumnDefault", () => {
  describe("safe SQL functions", () => {
    const safeFns = [
      "now()",
      "NOW()",
      "current_timestamp",
      "CURRENT_TIMESTAMP",
      "current_date",
      "CURRENT_DATE",
      "gen_random_uuid()",
      "GEN_RANDOM_UUID()",
      "uuid_generate_v4()",
      "NULL",
      "null",
      "TRUE",
      "true",
      "FALSE",
      "false",
    ];

    for (const val of safeFns) {
      it(`'${val}' passes`, () => {
        expect(() => assertColumnDefault(val, "col")).not.toThrow();
      });
    }
  });

  describe("numeric literals", () => {
    it("'0' passes", () => {
      expect(() => assertColumnDefault("0", "col")).not.toThrow();
    });

    it("'42' passes", () => {
      expect(() => assertColumnDefault("42", "col")).not.toThrow();
    });

    it("'-1' passes", () => {
      expect(() => assertColumnDefault("-1", "col")).not.toThrow();
    });

    it("'3.14' passes", () => {
      expect(() => assertColumnDefault("3.14", "col")).not.toThrow();
    });
  });

  describe("single-quoted string literals", () => {
    it("'active' passes", () => {
      expect(() => assertColumnDefault("'active'", "col")).not.toThrow();
    });

    it("'pending status' passes", () => {
      expect(() => assertColumnDefault("'pending status'", "col")).not.toThrow();
    });

    it("empty string '' passes", () => {
      expect(() => assertColumnDefault("''", "col")).not.toThrow();
    });

    it("escaped quote 'it''s ok' passes", () => {
      expect(() => assertColumnDefault("'it''s ok'", "col")).not.toThrow();
    });
  });

  describe("injection attempts — all must be rejected", () => {
    it("'0); DROP TABLE users; --' is rejected", () => {
      expect(() =>
        assertColumnDefault("0); DROP TABLE users; --", "col")
      ).toThrow();
    });

    it("'now()); DROP TABLE foo; --' is rejected", () => {
      expect(() =>
        assertColumnDefault("now()); DROP TABLE foo; --", "col")
      ).toThrow();
    });

    it("quote injection '; DROP TABLE users; --' is rejected", () => {
      // Looks like a single-quoted string but has an unclosed quote inside
      expect(() =>
        assertColumnDefault("'; DROP TABLE users; --'", "col")
      ).toThrow();
    });

    it("'1 OR 1=1' is rejected", () => {
      expect(() => assertColumnDefault("1 OR 1=1", "col")).toThrow();
    });

    it("'current_time()' is rejected (not in SAFE_FUNCTION_DEFAULTS)", () => {
      expect(() => assertColumnDefault("current_time()", "col")).toThrow();
    });

    it("empty string (unquoted) is rejected", () => {
      expect(() => assertColumnDefault("", "col")).toThrow();
    });

    it("whitespace-only string is rejected", () => {
      expect(() => assertColumnDefault("   ", "col")).toThrow();
    });

    it("error message includes the column name", () => {
      expect(() =>
        assertColumnDefault("DROP TABLE users", "my_col")
      ).toThrow(/my_col/);
    });
  });
});