/**
 * QueryBuilder unit testleri — SQL üretimi ve validasyon.
 */

import { describe, it, expect } from "vitest";
import {
  parseWhereConditions,
  parseSelectColumns,
  parseOrderBy,
} from "../../src/services/queryBuilder.js";

describe("parseWhereConditions", () => {
  it("eq operatörünü doğru çevirir", () => {
    const { sql, values } = parseWhereConditions(["name.eq.alice"]);
    expect(sql).toBe('WHERE "name" = $1');
    expect(values).toEqual(["alice"]);
  });

  it("gt operatörünü çevirir", () => {
    const { sql, values } = parseWhereConditions(["age.gt.18"]);
    expect(sql).toBe('WHERE "age" > $1');
    expect(values).toEqual(["18"]);
  });

  it("gte, lte, lt, neq operatörlerini çevirir", () => {
    expect(parseWhereConditions(["score.gte.90"]).sql).toBe('WHERE "score" >= $1');
    expect(parseWhereConditions(["score.lte.100"]).sql).toBe('WHERE "score" <= $1');
    expect(parseWhereConditions(["score.lt.50"]).sql).toBe('WHERE "score" < $1');
    expect(parseWhereConditions(["status.neq.inactive"]).sql).toBe('WHERE "status" != $1');
  });

  it("like ve ilike operatörlerini çevirir", () => {
    const { sql, values } = parseWhereConditions(["name.like.Ali%"]);
    expect(sql).toBe('WHERE "name" LIKE $1');
    expect(values).toEqual(["Ali%"]);

    const { sql: sql2 } = parseWhereConditions(["name.ilike.ali%"]);
    expect(sql2).toBe('WHERE "name" ILIKE $1');
  });

  it("in operatörünü çevirir", () => {
    const { sql, values } = parseWhereConditions(["status.in.a,b,c"]);
    expect(sql).toBe('WHERE "status" IN ($1, $2, $3)');
    expect(values).toEqual(["a", "b", "c"]);
  });

  it("is null çevirir", () => {
    const { sql, values } = parseWhereConditions(["deleted_at.is.null"]);
    expect(sql).toBe('WHERE "deleted_at" IS NULL');
    expect(values).toEqual([]);
  });

  it("birden fazla koşulu AND ile birleştirir", () => {
    const { sql, values } = parseWhereConditions([
      "age.gt.18",
      "status.eq.active",
    ]);
    expect(sql).toBe('WHERE "age" > $1 AND "status" = $2');
    expect(values).toEqual(["18", "active"]);
  });

  it("boş dizi için boş string döner", () => {
    const { sql, values } = parseWhereConditions([]);
    expect(sql).toBe("");
    expect(values).toEqual([]);
  });

  it("geçersiz kolon adında hata fırlatır", () => {
    expect(() => parseWhereConditions(["select.eq.x"])).toThrow();
  });

  it("geçersiz operatörde hata fırlatır", () => {
    expect(() => parseWhereConditions(["name.INVALID.x"])).toThrow(
      /Unknown operator/
    );
  });

  it("in operatörü değerleri doğru placeholder sayısıyla eşleşir", () => {
    const { sql, values } = parseWhereConditions(["id.in.1,2,3,4,5"]);
    expect(values).toHaveLength(5);
    expect(sql).toContain("$5");
  });
});

describe("parseSelectColumns", () => {
  it("* için * döner", () => {
    expect(parseSelectColumns("*")).toBe("*");
  });

  it("boş string için * döner", () => {
    expect(parseSelectColumns()).toBe("*");
  });

  it("undefined için * döner", () => {
    expect(parseSelectColumns(undefined)).toBe("*");
  });

  it("kolon listesini quote'lar", () => {
    expect(parseSelectColumns("id,name,email")).toBe('"id", "name", "email"');
  });

  it("tek kolon quote'lanır", () => {
    expect(parseSelectColumns("id")).toBe('"id"');
  });

  it("boşlukları trim eder", () => {
    expect(parseSelectColumns("id, name, email")).toBe('"id", "name", "email"');
  });

  it("geçersiz kolon adında hata fırlatır", () => {
    expect(() => parseSelectColumns("id,drop,name")).toThrow();
  });
});

describe("parseOrderBy", () => {
  it("asc sıralamayı çevirir", () => {
    expect(parseOrderBy("name.asc")).toBe('ORDER BY "name" ASC');
  });

  it("desc sıralamayı çevirir", () => {
    expect(parseOrderBy("created_at.desc")).toBe('ORDER BY "created_at" DESC');
  });

  it("tanımsız için boş string döner", () => {
    expect(parseOrderBy()).toBe("");
    expect(parseOrderBy(undefined)).toBe("");
  });

  it("geçersiz yön için hata fırlatır", () => {
    expect(() => parseOrderBy("name.RANDOM")).toThrow(/Invalid order direction/);
  });

  it("geçersiz kolon adı için hata fırlatır", () => {
    expect(() => parseOrderBy("drop.asc")).toThrow();
  });
});