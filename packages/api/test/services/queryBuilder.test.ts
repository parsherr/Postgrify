/**
 * QueryBuilder unit tests — SQL generation and validation.
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
  it("correctly translates the eq operator", () => {
    const { sql, values } = parseWhereConditions(["name.eq.alice"]);
    expect(sql).toBe('WHERE "name" = $1');
    expect(values).toEqual(["alice"]);
  });

  it("translates the gt operator", () => {
    const { sql, values } = parseWhereConditions(["age.gt.18"]);
    expect(sql).toBe('WHERE "age" > $1');
    expect(values).toEqual(["18"]);
  });

  it("translates gte, lte, lt, neq operators", () => {
    expect(parseWhereConditions(["score.gte.90"]).sql).toBe('WHERE "score" >= $1');
    expect(parseWhereConditions(["score.lte.100"]).sql).toBe('WHERE "score" <= $1');
    expect(parseWhereConditions(["score.lt.50"]).sql).toBe('WHERE "score" < $1');
    expect(parseWhereConditions(["status.neq.inactive"]).sql).toBe('WHERE "status" != $1');
  });

  it("translates the like and ilike operators", () => {
    const { sql, values } = parseWhereConditions(["name.like.Ali%"]);
    expect(sql).toBe('WHERE "name" LIKE $1');
    expect(values).toEqual(["Ali%"]);

    const { sql: sql2 } = parseWhereConditions(["name.ilike.ali%"]);
    expect(sql2).toBe('WHERE "name" ILIKE $1');
  });

  it("translates the in operator", () => {
    const { sql, values } = parseWhereConditions(["status.in.a,b,c"]);
    expect(sql).toBe('WHERE "status" IN ($1, $2, $3)');
    expect(values).toEqual(["a", "b", "c"]);
  });

  it("is.null → generates IS NULL without parameterizing the value", () => {
    const { sql, values } = parseWhereConditions(["deleted_at.is.null"]);
    expect(sql).toBe('WHERE "deleted_at" IS NULL');
    expect(values).toEqual([]);
  });

  it("is.not_null → generates IS NOT NULL", () => {
    const { sql, values } = parseWhereConditions(["deleted_at.is.not_null"]);
    expect(sql).toBe('WHERE "deleted_at" IS NOT NULL');
    expect(values).toEqual([]);
  });

  it("is.true → throws (invalid is value)", () => {
    expect(() => parseWhereConditions(["flag.is.true"])).toThrow(
      /Invalid value for "is" operator/
    );
  });

  it("is.false → throws (invalid is value)", () => {
    expect(() => parseWhereConditions(["flag.is.false"])).toThrow(
      /Invalid value for "is" operator/
    );
  });

  it("joins multiple conditions with AND", () => {
    const { sql, values } = parseWhereConditions([
      "age.gt.18",
      "status.eq.active",
    ]);
    expect(sql).toBe('WHERE "age" > $1 AND "status" = $2');
    expect(values).toEqual(["18", "active"]);
  });

  it("returns empty string for an empty array", () => {
    const { sql, values } = parseWhereConditions([]);
    expect(sql).toBe("");
    expect(values).toEqual([]);
  });

  it("throws on invalid column name", () => {
    expect(() => parseWhereConditions(["select.eq.x"])).toThrow();
  });

  it("throws on unknown operator", () => {
    expect(() => parseWhereConditions(["name.INVALID.x"])).toThrow(
      /Unknown operator/
    );
  });

  it("the legacy `not` operator is no longer valid — throws", () => {
    // `not` was removed; use neq instead
    expect(() => parseWhereConditions(["field.not.value"])).toThrow(
      /Unknown operator/
    );
  });

  it("in operator placeholder count matches value count", () => {
    const { sql, values } = parseWhereConditions(["id.in.1,2,3,4,5"]);
    expect(values).toHaveLength(5);
    expect(sql).toContain("$5");
  });

  it("throws on malformed format (no dot separator)", () => {
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

describe("parseWhereConditions — OR support", () => {
  it("generates a single OR condition inside parentheses", () => {
    const { sql, values } = parseWhereConditions([], ["role.eq.admin"]);
    expect(sql).toBe('WHERE ("role" = $1)');
    expect(values).toEqual(["admin"]);
  });

  it("joins multiple OR conditions with OR", () => {
    const { sql, values } = parseWhereConditions(
      [],
      ["role.eq.admin", "role.eq.mod"]
    );
    expect(sql).toBe('WHERE ("role" = $1 OR "role" = $2)');
    expect(values).toEqual(["admin", "mod"]);
  });

  it("AND + OR used together — placeholder order is correct", () => {
    const { sql, values } = parseWhereConditions(
      ["status.eq.active"],
      ["role.eq.admin", "role.eq.mod"]
    );
    expect(sql).toBe('WHERE "status" = $1 AND ("role" = $2 OR "role" = $3)');
    expect(values).toEqual(["active", "admin", "mod"]);
  });

  it("multiple AND + OR together", () => {
    const { sql, values } = parseWhereConditions(
      ["age.gt.18", "active.eq.true"],
      ["dept.eq.eng", "dept.eq.design"]
    );
    expect(sql).toBe(
      'WHERE "age" > $1 AND "active" = $2 AND ("dept" = $3 OR "dept" = $4)'
    );
    expect(values).toEqual(["18", "true", "eng", "design"]);
  });

  it("empty OR list produces an AND-only result", () => {
    const { sql, values } = parseWhereConditions(["name.eq.alice"], []);
    expect(sql).toBe('WHERE "name" = $1');
    expect(values).toEqual(["alice"]);
  });

  it("invalid operator inside OR throws", () => {
    expect(() =>
      parseWhereConditions([], ["field.INVALID.x"])
    ).toThrow(/Unknown operator/);
  });

  it("invalid column name inside OR throws", () => {
    expect(() =>
      parseWhereConditions([], ["drop.eq.x"])
    ).toThrow();
  });
});

describe("parseSelectColumns", () => {
  it("returns * for *", () => {
    expect(parseSelectColumns("*")).toBe("*");
  });

  it("returns * for empty string", () => {
    expect(parseSelectColumns("")).toBe("*");
  });

  it("returns * for undefined", () => {
    expect(parseSelectColumns(undefined)).toBe("*");
  });

  it("quotes a column list", () => {
    expect(parseSelectColumns("id,name,email")).toBe('"id", "name", "email"');
  });

  it("quotes a single column", () => {
    expect(parseSelectColumns("id")).toBe('"id"');
  });

  it("trims whitespace from column names", () => {
    expect(parseSelectColumns("id, name, email")).toBe('"id", "name", "email"');
  });

  it("throws on invalid column name", () => {
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

  it("rejects invalid aggregate column", () => {
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
  it("translates asc ordering", () => {
    expect(parseOrderBy("name.asc")).toBe('ORDER BY "name" ASC');
  });

  it("translates desc ordering", () => {
    expect(parseOrderBy("created_at.desc")).toBe('ORDER BY "created_at" DESC');
  });

  it("returns empty string for undefined", () => {
    expect(parseOrderBy()).toBe("");
    expect(parseOrderBy(undefined)).toBe("");
  });

  it("throws on invalid order direction", () => {
    expect(() => parseOrderBy("name.RANDOM")).toThrow(/Invalid order direction/);
  });

  it("throws on invalid column name", () => {
    expect(() => parseOrderBy("drop.asc")).toThrow();
  });
});