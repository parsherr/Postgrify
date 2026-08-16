import { describe, it, expect } from "vitest";
import {
  splitSelectTopLevel,
  parseEmbedSpec,
  tokenizeSelect,
} from "../../src/services/queryEmbed.js";
import { resolveRelation, type FkEdge } from "../../src/services/fkRelations.js";
import { buildEmbedSelectFragmentsSync } from "../../src/services/queryEmbedSql.js";
import { parseSelect, attachEmbedSql } from "../../src/services/querySelect.js";

describe("splitSelectTopLevel", () => {
  it("keeps commas inside embed parens", () => {
    expect(
      splitSelectTopLevel("id,author:users(name,email),title")
    ).toEqual(["id", "author:users(name,email)", "title"]);
  });
});

describe("parseEmbedSpec", () => {
  it("parses aliased embed", () => {
    expect(parseEmbedSpec("author:users(name,email)")).toEqual({
      alias: "author",
      table: "users",
      hint: null,
      star: false,
      columns: [
        { kind: "column", name: "name" },
        { kind: "column", name: "email" },
      ],
    });
  });

  it("parses table(*)", () => {
    expect(parseEmbedSpec("comments(*)")).toMatchObject({
      alias: "comments",
      table: "comments",
      star: true,
    });
  });

  it("parses hint", () => {
    expect(parseEmbedSpec("author:users!author_id(name)")).toMatchObject({
      alias: "author",
      table: "users",
      hint: "author_id",
    });
  });

  it("parses nested embed", () => {
    const spec = parseEmbedSpec("comments(body,author:users(name))");
    expect(spec?.columns).toHaveLength(2);
    expect(spec?.columns[1].kind).toBe("embed");
    expect(spec?.columns[1].embed?.table).toBe("users");
  });

  it("rejects empty embed ()", () => {
    expect(() => parseEmbedSpec("users()")).toThrow(/Empty embed/);
  });

  it("returns null for aggregates", () => {
    expect(parseEmbedSpec("amount.sum()")).toBeNull();
  });
});

describe("tokenizeSelect / parseSelect embeds", () => {
  it("tokenizes mix", () => {
    const t = tokenizeSelect("id,author:users(name),comments(body)");
    expect(t.map((x) => x.kind)).toEqual(["column", "embed", "embed"]);
  });

  it("parseSelect collects embeds", () => {
    const s = parseSelect("id,title,author:authors(name),comments(body)");
    expect(s.sql).toBe('"id", "title"');
    expect(s.embeds).toHaveLength(2);
    expect(s.embeds[0].alias).toBe("author");
    expect(s.embeds[1].table).toBe("comments");
  });

  it("rejects agg + embed", () => {
    expect(() =>
      parseSelect("n:id.count(),author:authors(name)")
    ).toThrow(/aggregate/);
  });
});

describe("resolveRelation", () => {
  const edges: FkEdge[] = [
    {
      constraintName: "posts_author_id_fkey",
      fromTable: "posts",
      fromColumn: "author_id",
      toTable: "authors",
      toColumn: "id",
    },
    {
      constraintName: "comments_post_id_fkey",
      fromTable: "comments",
      fromColumn: "post_id",
      toTable: "posts",
      toColumn: "id",
    },
  ];

  it("many-to-one authors from posts", () => {
    const r = resolveRelation(edges, "posts", "authors");
    expect(r.direction).toBe("many-to-one");
    expect(r.parentColumn).toBe("author_id");
    expect(r.embedColumn).toBe("id");
  });

  it("one-to-many comments from posts", () => {
    const r = resolveRelation(edges, "posts", "comments");
    expect(r.direction).toBe("one-to-many");
    expect(r.parentColumn).toBe("id");
    expect(r.embedColumn).toBe("post_id");
  });

  it("hint disambiguates", () => {
    const multi: FkEdge[] = [
      ...edges,
      {
        constraintName: "posts_editor_id_fkey",
        fromTable: "posts",
        fromColumn: "editor_id",
        toTable: "authors",
        toColumn: "id",
      },
    ];
    expect(() => resolveRelation(multi, "posts", "authors")).toThrow(
      /Ambiguous/
    );
    const r = resolveRelation(multi, "posts", "authors", "author_id");
    expect(r.parentColumn).toBe("author_id");
  });
});

describe("buildEmbedSelectFragmentsSync", () => {
  const edges: FkEdge[] = [
    {
      constraintName: "posts_author_id_fkey",
      fromTable: "posts",
      fromColumn: "author_id",
      toTable: "authors",
      toColumn: "id",
    },
    {
      constraintName: "comments_post_id_fkey",
      fromTable: "comments",
      fromColumn: "post_id",
      toTable: "posts",
      toColumn: "id",
    },
  ];

  it("builds many-to-one subquery", () => {
    const [sql] = buildEmbedSelectFragmentsSync(
      "posts",
      [parseEmbedSpec("author:authors(name)")!],
      edges
    );
    expect(sql).toContain("row_to_json");
    expect(sql).toContain('"authors"');
    expect(sql).toContain('"author_id"');
    expect(sql).toContain('AS "author"');
  });

  it("builds one-to-many subquery", () => {
    const [sql] = buildEmbedSelectFragmentsSync(
      "posts",
      [parseEmbedSpec("comments(body)")!],
      edges
    );
    expect(sql).toContain("json_agg");
    expect(sql).toContain('"post_id"');
  });

  it("attachEmbedSql joins fragments", () => {
    const parsed = parseSelect("id,author:authors(name)");
    const frags = buildEmbedSelectFragmentsSync("posts", parsed.embeds, edges);
    const out = attachEmbedSql(parsed, frags);
    expect(out.sql.startsWith('"id",')).toBe(true);
    expect(out.sql).toContain('AS "author"');
  });
});
