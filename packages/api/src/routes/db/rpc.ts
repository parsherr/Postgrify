/**
 * PostgREST-style RPC — call PostgreSQL functions over HTTP (E-09 / E-10).
 *
 *   GET  /:database/rpc/:function?arg=…   — named args from query string
 *   POST /:database/rpc/:function         — named args from JSON body
 *
 * Prefer:
 *   params=single-object  → body passed as single jsonb argument
 *   return=minimal        → 204 when no representation needed / void-like empty
 *
 * Safety (above PostgREST default):
 *   GET rejects VOLATILE functions (405) — side effects require POST
 *   Client SQL/type errors → 400 (not opaque 500)
 *
 * Optional query (GET and POST): limit, offset, order=col.asc|col.desc
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier, isValidIdentifier } from "../../utils/identifier.js";
import { parsePrefer } from "../../utils/prefer.js";

const RESERVED_QUERY_KEYS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "columns",
]);

type RpcArgs = Record<string, unknown>;

function collectGetArgs(query: Record<string, unknown>): RpcArgs {
  const args: RpcArgs = {};
  for (const [key, value] of Object.entries(query)) {
    if (RESERVED_QUERY_KEYS.has(key.toLowerCase())) continue;
    if (!isValidIdentifier(key)) {
      throw Object.assign(new Error(`Invalid parameter name: ${key}`), {
        statusCode: 400,
      });
    }
    args[key] = value;
  }
  return args;
}

function collectPostArgs(
  body: unknown,
  preferParams: string | null | undefined
): { mode: "named"; args: RpcArgs } | { mode: "single"; value: unknown } {
  if (preferParams === "single-object") {
    return { mode: "single", value: body ?? {} };
  }
  if (body === null || body === undefined) return { mode: "named", args: {} };
  if (typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("RPC body must be a JSON object"), {
      statusCode: 400,
    });
  }
  const args: RpcArgs = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!isValidIdentifier(key)) {
      throw Object.assign(new Error(`Invalid parameter name: ${key}`), {
        statusCode: 400,
      });
    }
    args[key] = value;
  }
  return { mode: "named", args };
}

function buildCallSql(
  fnName: string,
  call: { mode: "named"; args: RpcArgs } | { mode: "single"; value: unknown }
): { text: string; values: unknown[] } {
  assertIdentifier(fnName, "function");

  if (call.mode === "single") {
    return {
      text: `SELECT * FROM "${fnName}"($1::jsonb)`,
      values: [JSON.stringify(call.value)],
    };
  }

  const keys = Object.keys(call.args);
  if (keys.length === 0) {
    return { text: `SELECT * FROM "${fnName}"()`, values: [] };
  }

  const parts: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const key of keys) {
    parts.push(`"${key}" := $${i++}`);
    values.push(call.args[key]);
  }
  return {
    text: `SELECT * FROM "${fnName}"(${parts.join(", ")})`,
    values,
  };
}

function parseOrder(order: string | undefined): string {
  if (!order || typeof order !== "string") return "";
  const clauses: string[] = [];
  for (const part of order.split(",")) {
    const [colRaw, dirRaw] = part.trim().split(".");
    if (!colRaw || !isValidIdentifier(colRaw)) {
      throw Object.assign(new Error(`Invalid order column: ${colRaw}`), {
        statusCode: 400,
      });
    }
    const dir = (dirRaw ?? "asc").toLowerCase();
    if (dir !== "asc" && dir !== "desc") {
      throw Object.assign(new Error(`Invalid order direction: ${dirRaw}`), {
        statusCode: 400,
      });
    }
    clauses.push(`"${colRaw}" ${dir.toUpperCase()}`);
  }
  return clauses.length ? ` ORDER BY ${clauses.join(", ")}` : "";
}

function wrapWithPaging(
  callSql: string,
  query: Record<string, unknown>
): { text: string; extra: unknown[] } {
  const order = parseOrder(
    typeof query.order === "string" ? query.order : undefined
  );
  const limit =
    query.limit !== undefined ? Math.max(0, Number(query.limit)) : undefined;
  const offset =
    query.offset !== undefined ? Math.max(0, Number(query.offset)) : undefined;

  if (!order && limit === undefined && offset === undefined) {
    return { text: callSql, extra: [] };
  }

  let text = `SELECT * FROM (${callSql}) AS _postgrify_rpc${order}`;
  const extra: unknown[] = [];
  let p = (callSql.match(/\$\d+/g) ?? []).length + 1;
  if (limit !== undefined && !Number.isNaN(limit)) {
    text += ` LIMIT $${p++}`;
    extra.push(limit);
  }
  if (offset !== undefined && !Number.isNaN(offset)) {
    text += ` OFFSET $${p++}`;
    extra.push(offset);
  }
  return { text, extra };
}

function unwrapResult(rows: Record<string, unknown>[]): unknown {
  if (rows.length === 1) {
    const keys = Object.keys(rows[0]);
    if (keys.length === 1) return rows[0][keys[0]];
  }
  return rows;
}

async function resolvePublicFunction(
  sql: ReturnType<FastifyInstance["poolManager"]["getPool"]>,
  fnName: string
): Promise<{ provolatile: "i" | "s" | "v" } | null> {
  const rows = await sql`
    SELECT p.provolatile
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ${fnName}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { provolatile: rows[0].provolatile as "i" | "s" | "v" };
}

function isClientSqlError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid input syntax|cannot cast|could not convert|function .* is not unique|ambiguous function|cannot call/i.test(
    msg
  );
}

function preferRequestsMinimal(
  header: string | string[] | undefined
): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return /(?:^|,)\s*return\s*=\s*minimal\s*(?:,|$)/i.test(raw);
}

async function executeRpc(
  server: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  callArgs: { mode: "named"; args: RpcArgs } | { mode: "single"; value: unknown }
) {
  const { function: fnName } = req.params as { function: string };
  const query = req.query as Record<string, unknown>;

  let call;
  try {
    call = buildCallSql(fnName, callArgs);
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return reply.status(e.statusCode ?? 400).send({ error: e.message });
  }

  let wrapped;
  try {
    wrapped = wrapWithPaging(call.text, query);
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return reply.status(e.statusCode ?? 400).send({ error: e.message });
  }

  const sql = server.poolManager.getPool(req.dbName!);
  const meta = await resolvePublicFunction(sql, fnName);
  if (!meta) {
    return reply.status(404).send({ error: `Function not found: ${fnName}` });
  }

  // GET must not run VOLATILE side effects (PostgREST footgun → industry harden).
  if (req.method === "GET" && meta.provolatile === "v") {
    return reply.status(405).send({
      error: "Method Not Allowed",
      message:
        "VOLATILE functions cannot be called with GET. Use POST /rpc/:function instead.",
    });
  }

  const values = [...call.values, ...wrapped.extra];
  let rows: Record<string, unknown>[];
  try {
    rows = (await sql.unsafe(
      wrapped.text,
      values as never[]
    )) as Record<string, unknown>[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isClientSqlError(err)) {
      return reply.status(400).send({ error: msg });
    }
    throw err;
  }

  // RPC default is representation (unlike table mutations). Only 204 when asked.
  if (preferRequestsMinimal(req.headers.prefer)) {
    reply.header("Preference-Applied", "return=minimal");
    return reply.status(204).send();
  }

  if (rows.length === 0) {
    return reply.send([]);
  }

  return reply.send(unwrapResult(rows));
}

export async function rpcRoute(server: FastifyInstance) {
  const guards = [scopeGuard("query")] as const;

  server.get(
    "/:database/rpc/:function",
    {
      preHandler: [...guards],
      schema: {
        description:
          "Call a PostgreSQL function with named args from the query string (E-09).",
        tags: ["rpc"],
      },
    },
    asyncHandler(async (req, reply) => {
      let args: RpcArgs;
      try {
        args = collectGetArgs(req.query as Record<string, unknown>);
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 400).send({ error: e.message });
      }
      return executeRpc(server, req, reply, { mode: "named", args });
    })
  );

  server.post(
    "/:database/rpc/:function",
    {
      preHandler: [...guards],
      schema: {
        description:
          "Call a PostgreSQL function with named args from JSON body (E-10). Prefer: params=single-object.",
        tags: ["rpc"],
      },
    },
    asyncHandler(async (req, reply) => {
      const prefer = parsePrefer(req.headers.prefer);
      let callArgs: { mode: "named"; args: RpcArgs } | { mode: "single"; value: unknown };
      try {
        callArgs = collectPostArgs(req.body, prefer.params);
      } catch (err) {
        const e = err as Error & { statusCode?: number };
        return reply.status(e.statusCode ?? 400).send({ error: e.message });
      }
      return executeRpc(server, req, reply, callArgs);
    })
  );

  server.options(
    "/:database/rpc/:function",
    {
      schema: {
        description: "CORS / Allow discovery for RPC (E-04).",
        tags: ["rpc"],
      },
    },
    async (_req, reply) => {
      reply.header("Allow", "GET, POST, HEAD, OPTIONS");
      return reply.status(204).send();
    }
  );
}
