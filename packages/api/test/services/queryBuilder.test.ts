/**
 * QueryBuilder unit testleri — SQL üretimi ve validasyon.
 */

import { describe, it, expect } from "vitest";
import {
  parseWhereConditions,
  parseSelectColumns,
  parseSelect,
  parseOrderBy,
  toColumnSql,
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

  it("is.null → IS NULL üretir, değer parametrize edilmez", () => {
    const { sql, values } = parseWhereConditions(["deleted_at.is.null"]);
    expect(sql).toBe('WHERE "deleted_at" IS NULL');
    expect(values).toEqual([]);
  });

  it("is.not_null → IS NOT NULL üretir", () => {
    const { sql, values } = parseWhereConditions(["deleted_at.is.not_null"]);
    expect(sql).toBe('WHERE "deleted_at" IS NOT NULL');
    expect(values).toEqual([]);
  });

  it("is.true → hata fırlatır (geçersiz is değeri)", () => {
    expect(() => parseWhereConditions(["flag.is.true"])).toThrow(
      /Invalid value for "is" operator/
    );
  });

  it("is.false → hata fırlatır (geçersiz is değeri)", () => {
    expect(() => parseWhereConditions(["flag.is.false"])).toThrow(
      /Invalid value for "is" operator/
    );
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

  it("eski `not` operatörü artık geçersiz — hata fırlatır", () => {
    // `not` kaldırıldı; neq kullanılmalı
    expect(() => parseWhereConditions(["field.not.value"])).toThrow(
      /Unknown operator/
    );
  });

  it("in operatörü değerleri doğru placeholder sayısıyla eşleşir", () => {
    const { sql, values } = parseWhereConditions(["id.in.1,2,3,4,5"]);
    expect(values).toHaveLength(5);
    expect(sql).toContain("$5");
  });

  it("hatalı format (nokta yok) hata fırlatır", () => {
    expect(() => parseWhereConditions(["badformat"])).toThrow();
  });
});

describe("parseWhereConditions — FTS (E-11)", () => {
  it("plfts without lang → plainto_tsquery($1)", () => {
    const { sql, values } = parseWhereConditions(["body.plfts.yapay zeka"]);
    expect(sql).toBe('WHERE "body" @@ plainto_tsquery($1)');
    expect(values).toEqual(["yapay zeka"]);
  });

  it("plfts(turkish) → regconfig param + query", () => {
    const { sql, values } = parseWhereConditions([
      "body.plfts(turkish).yapay+zeka",
    ]);
    expect(sql).toBe(
      'WHERE "body" @@ plainto_tsquery($1::regconfig, $2)'
    );
    expect(values).toEqual(["turkish", "yapay+zeka"]);
  });

  it("fts / phfts / wfts map to correct constructors", () => {
    expect(parseWhereConditions(["t.fts.foo"]).sql).toContain("to_tsquery($1)");
    expect(parseWhereConditions(["t.phfts.foo bar"]).sql).toContain(
      "phraseto_tsquery($1)"
    );
    expect(parseWhereConditions(["t.wfts.laptop"]).sql).toContain(
      "websearch_to_tsquery($1)"
    );
  });

  it("empty FTS query throws", () => {
    expect(() => parseWhereConditions(["body.plfts."])).toThrow(/Empty FTS/);
  });

  it("FTS + AND keeps placeholder order", () => {
    const { sql, values } = parseWhereConditions([
      "status.eq.active",
      "body.plfts(english).neural",
    ]);
    expect(sql).toBe(
      'WHERE "status" = $1 AND "body" @@ plainto_tsquery($2::regconfig, $3)'
    );
    expect(values).toEqual(["active", "english", "neural"]);
  });

  it("rejects injection-shaped lang via unknown operator path", () => {
    // lang with ); would fail FTS regex → falls through to unknown op
    expect(() =>
      parseWhereConditions(["body.plfts(english);drop).x"])
    ).toThrow();
  });
});

describe("toColumnSql / JSONB paths (E-14)", () => {
  it("plain identifier", () => {
    expect(toColumnSql("settings")).toBe('"settings"');
  });

  it("settings->>'theme'", () => {
    expect(toColumnSql("settings->>'theme'")).toBe("\"settings\"->>'theme'");
  });

  it("nested attrs->'specs'->>'weight'", () => {
    expect(toColumnSql("attrs->'specs'->>'weight'")).toBe(
      "\"attrs\"->'specs'->>'weight'"
    );
  });

  it("array index data->0->>'name'", () => {
    expect(toColumnSql("data->0->>'name'")).toBe("\"data\"->0->>'name'");
  });

  it("rejects injection in key", () => {
    expect(() => toColumnSql("settings->>'theme';drop--'")).toThrow();
  });
});

describe("parseWhereConditions — JSONB (E-14)", () => {
  it("settings->>'theme'.eq.dark", () => {
    const { sql, values } = parseWhereConditions([
      "settings->>'theme'.eq.dark",
    ]);
    expect(sql).toBe("WHERE \"settings\"->>'theme' = $1");
    expect(values).toEqual(["dark"]);
  });

  it("nested path lt (text compare — ->> yields text)", () => {
    const { sql, values } = parseWhereConditions([
      "attrs->'specs'->>'weight'.lt.5",
    ]);
    expect(sql).toBe("WHERE \"attrs\"->'specs'->>'weight' < $1");
    expect(values).toEqual(["5"]);
  });

  it("json path + AND plain column", () => {
    const { sql, values } = parseWhereConditions([
      "settings->>'theme'.eq.dark",
      "id.gt.1",
    ]);
    expect(sql).toBe(
      "WHERE \"settings\"->>'theme' = $1 AND \"id\" > $2"
    );
    expect(values).toEqual(["dark", "1"]);
  });

  it("json path is.null", () => {
    const { sql, values } = parseWhereConditions([
      "settings->>'theme'.is.null",
    ]);
    expect(sql).toBe("WHERE \"settings\"->>'theme' IS NULL");
    expect(values).toEqual([]);
  });

  it("rejects bad json path", () => {
    expect(() =>
      parseWhereConditions(["settings->>'thm;drop'.eq.x"])
    ).toThrow(/Invalid/);
  });
});

describe("parseWhereConditions — OR desteği", () => {
  it("tek OR koşulunu parantez içinde üretir", () => {
    const { sql, values } = parseWhereConditions([], ["role.eq.admin"]);
    expect(sql).toBe('WHERE ("role" = $1)');
    expect(values).toEqual(["admin"]);
  });

  it("birden fazla OR koşulunu OR ile birleştirir", () => {
    const { sql, values } = parseWhereConditions(
      [],
      ["role.eq.admin", "role.eq.mod"]
    );
    expect(sql).toBe('WHERE ("role" = $1 OR "role" = $2)');
    expect(values).toEqual(["admin", "mod"]);
  });

  it("AND + OR birlikte kullanılır — placeholder sıraları doğru", () => {
    const { sql, values } = parseWhereConditions(
      ["status.eq.active"],
      ["role.eq.admin", "role.eq.mod"]
    );
    expect(sql).toBe('WHERE "status" = $1 AND ("role" = $2 OR "role" = $3)');
    expect(values).toEqual(["active", "admin", "mod"]);
  });

  it("birden fazla AND + OR birlikte", () => {
    const { sql, values } = parseWhereConditions(
      ["age.gt.18", "active.eq.true"],
      ["dept.eq.eng", "dept.eq.design"]
    );
    expect(sql).toBe(
      'WHERE "age" > $1 AND "active" = $2 AND ("dept" = $3 OR "dept" = $4)'
    );
    expect(values).toEqual(["18", "true", "eng", "design"]);
  });

  it("boş OR listesi AND-only sonuç verir", () => {
    const { sql, values } = parseWhereConditions(["name.eq.alice"], []);
    expect(sql).toBe('WHERE "name" = $1');
    expect(values).toEqual(["alice"]);
  });

  it("OR içinde geçersiz operatör hata fırlatır", () => {
    expect(() =>
      parseWhereConditions([], ["field.INVALID.x"])
    ).toThrow(/Unknown operator/);
  });

  it("OR içinde geçersiz kolon adı hata fırlatır", () => {
    expect(() =>
      parseWhereConditions([], ["drop.eq.x"])
    ).toThrow();
  });
});

describe("parseSelectColumns", () => {
  it("* için * döner", () => {
    expect(parseSelectColumns("*")).toBe("*");
  });

  it("boş string için * döner", () => {
    expect(parseSelectColumns("")).toBe("*");
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

  it("E-18 select cast duration::text keeps duration key", () => {
    expect(parseSelectColumns("id,duration::text")).toBe(
      '"id", ("duration")::text AS "duration"'
    );
  });

  it("E-18 reject unknown cast type in select", () => {
    expect(() => parseSelectColumns("id::notatype")).toThrow(/Invalid cast/);
  });
});

describe("parseSelect — aggregates (E-20)", () => {
  it("plain columns unchanged (no GROUP BY)", () => {
    const s = parseSelect("id,name");
    expect(s.sql).toBe('"id", "name"');
    expect(s.groupBySql).toBe("");
    expect(s.hasAggregate).toBe(false);
  });

  it("amount.sum() with default alias", () => {
    const s = parseSelect("amount.sum()");
    expect(s.sql).toBe('SUM("amount") AS "sum"');
    expect(s.groupBySql).toBe("");
    expect(s.hasAggregate).toBe(true);
  });

  it("status + aliased sum/count → GROUP BY status", () => {
    const s = parseSelect("status,total:amount.sum(),n:id.count()");
    expect(s.sql).toBe(
      '"status", SUM("amount") AS "total", COUNT("id") AS "n"'
    );
    expect(s.groupBySql).toBe('GROUP BY "status"');
  });

  it("avg with cast", () => {
    const s = parseSelect("avg_price:price.avg()::int");
    expect(s.sql).toBe('(AVG("price"))::int AS "avg_price"');
    expect(s.groupBySql).toBe("");
  });

  it("bare count()", () => {
    const s = parseSelect("count()");
    expect(s.sql).toBe('COUNT(*) AS "count"');
  });

  it("rejects * with aggregates", () => {
    expect(() => parseSelect("*,amount.sum()")).toThrow(/\*/);
  });

  it("rejects invalid agg column", () => {
    expect(() => parseSelect("drop.sum()")).toThrow();
  });

  it("alias on plain column", () => {
    const s = parseSelect("fullName:name,n:id.count()");
    expect(s.sql).toBe('"name" AS "fullName", COUNT("id") AS "n"');
    expect(s.groupBySql).toBe('GROUP BY "name"');
  });
});

describe("toColumnSql / cast (E-18)", () => {
  it("plain::numeric", () => {
    expect(toColumnSql("amount::numeric")).toBe('("amount")::numeric');
  });

  it("json path::float", () => {
    expect(toColumnSql("attrs->'specs'->>'weight'::float")).toBe(
      "(\"attrs\"->'specs'->>'weight')::float"
    );
  });

  it("rejects dangerous cast type", () => {
    expect(() => toColumnSql("id::pg_catalog")).toThrow(/Invalid cast/);
  });
});

describe("parseWhereConditions — cast (E-18)", () => {
  it("json text extract cast to float then lt", () => {
    const { sql, values } = parseWhereConditions([
      "attrs->'specs'->>'weight'::float.lt.5",
    ]);
    expect(sql).toBe(
      "WHERE (\"attrs\"->'specs'->>'weight')::float < $1"
    );
    expect(values).toEqual(["5"]);
  });

  it("amount::int.gte.10", () => {
    const { sql, values } = parseWhereConditions(["amount::int.gte.10"]);
    expect(sql).toBe('WHERE ("amount")::int >= $1');
    expect(values).toEqual(["10"]);
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