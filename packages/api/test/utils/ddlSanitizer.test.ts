/**
 * ddlSanitizer unit testleri.
 * assertColumnType ve assertColumnDefault fonksiyonlarının
 * allowlist ve injection koruması doğrulanır.
 */

import { describe, it, expect } from "vitest";
import {
  assertColumnType,
  assertColumnDefault,
} from "../../src/utils/ddlSanitizer.js";

// ─── assertColumnType ─────────────────────────────────────────────────────────

describe("assertColumnType", () => {
  describe("geçerli tipler", () => {
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
      it(`'${type}' geçer`, () => {
        expect(() => assertColumnType(type, "col")).not.toThrow();
      });
    }

    it("küçük harf 'text' büyük harfe normalize edilip geçer", () => {
      expect(() => assertColumnType("text", "col")).not.toThrow();
      expect(assertColumnType("text", "col")).toBe("TEXT");
    });

    it("'VARCHAR(255)' parantez normalize edilip geçer", () => {
      expect(() => assertColumnType("VARCHAR(255)", "col")).not.toThrow();
    });

    it("'NUMERIC(10,2)' geçer", () => {
      expect(() => assertColumnType("NUMERIC(10,2)", "col")).not.toThrow();
    });

    it("'character varying' geçer", () => {
      expect(() => assertColumnType("character varying", "col")).not.toThrow();
    });
  });

  describe("geçersiz / injection denemeleri", () => {
    it("'VOID' reddedilir", () => {
      expect(() => assertColumnType("VOID", "col")).toThrow();
    });

    it("'FUNCTION' reddedilir", () => {
      expect(() => assertColumnType("FUNCTION", "col")).toThrow();
    });

    it("'BYTECODE' reddedilir", () => {
      expect(() => assertColumnType("BYTECODE", "col")).toThrow();
    });

    it("boş string reddedilir", () => {
      expect(() => assertColumnType("", "col")).toThrow();
    });

    it("sadece boşluk reddedilir", () => {
      expect(() => assertColumnType("   ", "col")).toThrow();
    });

    it("'TEXT; DROP TABLE users' injection reddedilir", () => {
      expect(() => assertColumnType("TEXT; DROP TABLE users", "col")).toThrow();
    });

    it("'TEXT REFERENCES other(id)' reddedilir", () => {
      expect(() => assertColumnType("TEXT REFERENCES other(id)", "col")).toThrow();
    });

    it("hata mesajı kolon adını içerir", () => {
      expect(() => assertColumnType("VOID", "my_column")).toThrow(/my_column/);
    });
  });
});

// ─── assertColumnDefault ─────────────────────────────────────────────────────

describe("assertColumnDefault", () => {
  describe("güvenli SQL fonksiyonları", () => {
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
      it(`'${val}' geçer`, () => {
        expect(() => assertColumnDefault(val, "col")).not.toThrow();
      });
    }
  });

  describe("sayısal literaller", () => {
    it("'0' geçer", () => {
      expect(() => assertColumnDefault("0", "col")).not.toThrow();
    });

    it("'42' geçer", () => {
      expect(() => assertColumnDefault("42", "col")).not.toThrow();
    });

    it("'-1' geçer", () => {
      expect(() => assertColumnDefault("-1", "col")).not.toThrow();
    });

    it("'3.14' geçer", () => {
      expect(() => assertColumnDefault("3.14", "col")).not.toThrow();
    });
  });

  describe("tek tırnaklı string literaller", () => {
    it("'active' geçer", () => {
      expect(() => assertColumnDefault("'active'", "col")).not.toThrow();
    });

    it("'pending status' geçer", () => {
      expect(() => assertColumnDefault("'pending status'", "col")).not.toThrow();
    });

    it("boş string '' geçer", () => {
      expect(() => assertColumnDefault("''", "col")).not.toThrow();
    });

    it("escaped quote 'it''s ok' geçer", () => {
      expect(() => assertColumnDefault("'it''s ok'", "col")).not.toThrow();
    });
  });

  describe("injection denemeleri — tümü reddedilmeli", () => {
    it("'0); DROP TABLE users; --' reddedilir", () => {
      expect(() =>
        assertColumnDefault("0); DROP TABLE users; --", "col")
      ).toThrow();
    });

    it("'now()); DROP TABLE foo; --' reddedilir", () => {
      expect(() =>
        assertColumnDefault("now()); DROP TABLE foo; --", "col")
      ).toThrow();
    });

    it("tırnak injection '; DROP TABLE users; --' reddedilir", () => {
      // Tek tırnaklı string gibi görünür ama içinde kapanmamış tırnak var
      expect(() =>
        assertColumnDefault("'; DROP TABLE users; --'", "col")
      ).toThrow();
    });

    it("'1 OR 1=1' reddedilir", () => {
      expect(() => assertColumnDefault("1 OR 1=1", "col")).toThrow();
    });

    it("'current_time()' reddedilir (SAFE_FUNCTION_DEFAULTS'ta yok)", () => {
      expect(() => assertColumnDefault("current_time()", "col")).toThrow();
    });

    it("boş string (tırnaksız) reddedilir", () => {
      expect(() => assertColumnDefault("", "col")).toThrow();
    });

    it("sadece boşluk reddedilir", () => {
      expect(() => assertColumnDefault("   ", "col")).toThrow();
    });

    it("hata mesajı kolon adını içerir", () => {
      expect(() =>
        assertColumnDefault("DROP TABLE users", "my_col")
      ).toThrow(/my_col/);
    });
  });
});
