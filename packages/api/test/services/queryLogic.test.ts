import { describe, it, expect } from "vitest";
import {
  splitTopLevelCommas,
  unwrapOuterParens,
  parseLogicParam,
  isFlatAtomList,
  MAX_LOGIC_DEPTH,
} from "../../src/services/queryLogic.js";
import { parseWhereConditions } from "../../src/services/queryBuilder.js";

describe("splitTopLevelCommas", () => {
  it("splits flat list", () => {
    expect(splitTopLevelCommas("a.eq.1,b.eq.2")).toEqual(["a.eq.1", "b.eq.2"]);
  });

  it("keeps commas inside nested groups", () => {
    expect(
      splitTopLevelCommas("status.eq.pending,and=(total.gt.100,customer_id.eq.5)")
    ).toEqual([
      "status.eq.pending",
      "and=(total.gt.100,customer_id.eq.5)",
    ]);
  });

  it("rejects unbalanced parens", () => {
    expect(() => splitTopLevelCommas("a.eq.1,and=(b.eq.2")).toThrow(
      /Unbalanced/
    );
  });
});

describe("unwrapOuterParens", () => {
  it("unwraps full wrap", () => {
    expect(unwrapOuterParens("(a.eq.1,b.eq.2)")).toBe("a.eq.1,b.eq.2");
  });

  it("leaves non-wrapped", () => {
    expect(unwrapOuterParens("a.eq.1,b.eq.2")).toBe("a.eq.1,b.eq.2");
  });

  it("does not unwrap partial wrap", () => {
    expect(unwrapOuterParens("(a.eq.1),b.eq.2")).toBe("(a.eq.1),b.eq.2");
  });
});

describe("parseLogicParam", () => {
  const atom = (c: string, offset: number) => {
    const [col, op, ...rest] = c.split(".");
    const val = rest.join(".");
    const sqlOp = op === "eq" ? "=" : op === "gt" ? ">" : op === "lt" ? "<" : op;
    return { sql: `"${col}" ${sqlOp} $${offset + 1}`, values: [val] };
  };

  it("flat OR list", () => {
    const { sql, values } = parseLogicParam(
      "age.lt.18,age.gt.65",
      "OR",
      0,
      atom
    );
    expect(sql).toBe('("age" < $1 OR "age" > $2)');
    expect(values).toEqual(["18", "65"]);
  });

  it("paren-wrapped OR", () => {
    const { sql, values } = parseLogicParam(
      "(age.lt.18,age.gt.65)",
      "OR",
      0,
      atom
    );
    expect(sql).toBe('("age" < $1 OR "age" > $2)');
    expect(values).toEqual(["18", "65"]);
  });

  it("nested and inside or", () => {
    const { sql, values } = parseLogicParam(
      "(status.eq.pending,and=(total.gt.100,customer_id.eq.5))",
      "OR",
      0,
      atom
    );
    expect(sql).toBe(
      '("status" = $1 OR ("total" > $2 AND "customer_id" = $3))'
    );
    expect(values).toEqual(["pending", "100", "5"]);
  });

  it("and= group as whole value", () => {
    const { sql, values } = parseLogicParam(
      "and=(status.eq.pending,total.gt.100)",
      "AND",
      0,
      atom
    );
    expect(sql).toBe('("status" = $1 AND "total" > $2)');
    expect(values).toEqual(["pending", "100"]);
  });

  it("not.and group", () => {
    const { sql, values } = parseLogicParam(
      "not.and=(price.lt.10,stock.eq.0)",
      "AND",
      0,
      atom
    );
    expect(sql).toBe('NOT ("price" < $1 AND "stock" = $2)');
    expect(values).toEqual(["10", "0"]);
  });

  it("options.not wraps result", () => {
    const { sql, values } = parseLogicParam(
      "(role.eq.banned,role.eq.deleted)",
      "OR",
      0,
      atom,
      { not: true }
    );
    expect(sql).toBe('NOT ("role" = $1 OR "role" = $2)');
    expect(values).toEqual(["banned", "deleted"]);
  });

  it("rejects empty group", () => {
    expect(() => parseLogicParam("()", "OR", 0, atom)).toThrow(/Empty/);
  });

  it("rejects excessive nesting", () => {
    let expr = "a.eq.1";
    for (let i = 0; i < MAX_LOGIC_DEPTH + 2; i++) {
      expr = `and=(${expr})`;
    }
    expect(() => parseLogicParam(expr, "AND", 0, atom)).toThrow(/too deep/);
  });
});

describe("isFlatAtomList", () => {
  it("true for legacy atoms", () => {
    expect(isFlatAtomList(["role.eq.admin", "role.eq.mod"])).toBe(true);
  });

  it("false when parens present", () => {
    expect(isFlatAtomList(["(role.eq.admin,role.eq.mod)"])).toBe(false);
  });
});

describe("parseWhereConditions — E-15 nested logic", () => {
  it("legacy flat OR unchanged", () => {
    const { sql, values } = parseWhereConditions(
      ["status.eq.active"],
      ["role.eq.admin", "role.eq.mod"]
    );
    expect(sql).toBe(
      'WHERE "status" = $1 AND ("role" = $2 OR "role" = $3)'
    );
    expect(values).toEqual(["active", "admin", "mod"]);
  });

  it("PostgREST or=(a,b)", () => {
    const { sql, values } = parseWhereConditions(
      [],
      ["(age.lt.18,age.gt.65)"],
      { orRaw: true }
    );
    expect(sql).toBe('WHERE ("age" < $1 OR "age" > $2)');
    expect(values).toEqual(["18", "65"]);
  });

  it("nested or with and", () => {
    const { sql, values } = parseWhereConditions(
      [],
      ["(status.eq.pending,and=(total.gt.100,customer_id.eq.5))"],
      { orRaw: true }
    );
    expect(sql).toBe(
      'WHERE ("status" = $1 OR ("total" > $2 AND "customer_id" = $3))'
    );
    expect(values).toEqual(["pending", "100", "5"]);
  });

  it("top-level and= param", () => {
    const { sql, values } = parseWhereConditions([], [], {
      and: ["(status.eq.pending,total.gt.100)"],
    });
    expect(sql).toBe('WHERE ("status" = $1 AND "total" > $2)');
    expect(values).toEqual(["pending", "100"]);
  });

  it("not.and param", () => {
    const { sql, values } = parseWhereConditions([], [], {
      notAnd: ["(price.lt.10,stock.eq.0)"],
    });
    expect(sql).toBe('WHERE NOT ("price" < $1 AND "stock" = $2)');
    expect(values).toEqual(["10", "0"]);
  });

  it("where + nested or together", () => {
    const { sql, values } = parseWhereConditions(
      ["active.eq.true"],
      ["(role.eq.admin,and=(dept.eq.eng,level.gt.3))"],
      { orRaw: true }
    );
    expect(sql).toBe(
      'WHERE "active" = $1 AND ("role" = $2 OR ("dept" = $3 AND "level" > $4))'
    );
    expect(values).toEqual(["true", "admin", "eng", "3"]);
  });

  it("rejects injection-shaped group name", () => {
    expect(() =>
      parseWhereConditions([], ["drop=(id.eq.1)"], { orRaw: true })
    ).toThrow();
  });
});
