/**
 * Image upload endpoint tests.
 *
 * Test scenarios:
 *   POST /:database/:table/:column/upload
 *     - Valid image → 200
 *     - Invalid MIME type → 415
 *     - Missing ?id param → 400
 *     - Invalid table name → 400
 *     - Row not found → 404
 *     - Without auth → 401
 *     - Token without write scope → 403
 *
 *   GET /:database/:table/:id/:column/raw
 *     - Existing row with mime column → 200, correct Content-Type
 *     - Existing row with ?mime fallback → 200, fallback Content-Type
 *     - No mime → application/octet-stream
 *     - Row not found → 404
 *     - Null bytea column → 404
 *     - Invalid table name → 400
 *     - Without auth → 401
 *     - Cache-Control header is present
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { JwtService } from "../../src/services/jwtService.js";

const JWT_SECRET = "test-secret-must-be-at-least-32-characters";
const ADMIN_SECRET = "test-admin-secret-16ch";

vi.stubEnv("JWT_SECRET", JWT_SECRET);
vi.stubEnv("ADMIN_SECRET", ADMIN_SECRET);

// ── @fastify/multipart mock ───────────────────────────────────────────────────
// Completely bypassing the real plugin — no-op.
// addContentTypeParser and the req.file() decorator are added manually in beforeAll.
vi.mock("@fastify/multipart", () => {
  const noopPlugin = async () => { /* intentional no-op */ };
  noopPlugin[Symbol.for("skip-override")] = true;
  return { default: noopPlugin };
});

// ── postgres mock ─────────────────────────────────────────────────────────────
let mockTaggedResults: unknown[][] = [];
let mockUnsafeResults: unknown[][] = [];

vi.mock("postgres", () => {
  const sqlFn: Record<string, unknown> = vi.fn((..._args: unknown[]) => {
    const r = mockTaggedResults.shift();
    return Promise.resolve(r ?? []);
  });
  sqlFn.unsafe = vi.fn((..._args: unknown[]) => {
    const r = mockUnsafeResults.shift();
    return Promise.resolve(r ?? []);
  });
  sqlFn.end = vi.fn().mockResolvedValue(undefined);
  sqlFn.begin = vi.fn();
  const factory = vi.fn(() => sqlFn);
  return { default: factory };
});

// ── cache mock ────────────────────────────────────────────────────────────────
vi.mock("../../src/services/cacheService.js", () => ({
  CacheService: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
    invalidatePattern: vi.fn().mockResolvedValue(undefined),
    buildKey: (...p: string[]) => `postgrify:${p.join(":")}`,
  })),
  TTL: { ROW_QUERY: 30, SCHEMA: 300, TABLE_LIST: 120, DB_SIZE: 60 },
}));

// ── Test state for req.file() simulation ─────────────────────────────────────
// Real JPEG magic bytes — required to pass the magic bytes check in upload.ts.
// Buffer.from("fake-image-data") does not start with 0xFF, causing the magic check to return 415.
const fakeBuffer = Buffer.concat([
  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]), // JPEG magic
  Buffer.from("fake-image-data"),
]);

type FakeFile = {
  mimetype: string;
  filename: string;
  toBuffer: () => Promise<Buffer>;
};

let mockFileFactory: () => Promise<FakeFile | null> = () =>
  Promise.resolve({
    mimetype: "image/jpeg",
    filename: "test.jpg",
    toBuffer: () => Promise.resolve(fakeBuffer),
  });

// ── Server setup ──────────────────────────────────────────────────────────────
let server: FastifyInstance;
let adminToken: string;
let readOnlyToken: string;

beforeAll(async () => {
  server = Fastify({ logger: false });

  // multipart/form-data body parser — Fastify does not recognize it by default and throws 415.
  // Because the @fastify/multipart mock is a no-op, we add this manually.
  server.addContentTypeParser(
    "multipart/form-data",
    { parseAs: "buffer" },
    (_req, _body, done) => {
      done(null, _body);
    }
  );

  // Decorators
  server.decorateRequest("user", null);
  server.decorateRequest("dbName", null);

  // req.file() — decorator that calls the mock factory
  server.decorateRequest("file", function (this: FastifyRequest) {
    void this;
    return mockFileFactory();
  });

  // poolManager mock
  const { PoolManager } = await import("../../src/services/poolManager.js");
  server.decorate("poolManager", new PoolManager({} as never));

  // cache mock
  const { CacheService } = await import("../../src/services/cacheService.js");
  server.decorate("cache", new CacheService());

  // auth decorators
  const jwtSvc = new JwtService(JWT_SECRET);
  server.decorate("jwtService", jwtSvc);
  server.decorate(
    "authenticate",
    async (req: FastifyRequest, reply: { status: (n: number) => { send: (b: unknown) => void } }) => {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const payload = await jwtSvc.verify(auth.slice(7));
      if (!payload) {
        return reply.status(401).send({ error: "Invalid token" });
      }
      (req as FastifyRequest & { user: unknown }).user = payload;
    }
  );
  server.decorate("authenticateAdmin", async () => {});
  server.decorate("authenticateAny", async (req: never, reply: never) => {
    return (server as never as { authenticate: (r: never, rep: never) => Promise<void> }).authenticate(req, reply);
  });

  // Register route group
  const { dbRoutes } = await import("../../src/routes/db/index.js");
  await server.register(dbRoutes, { prefix: "/db" });
  await server.ready();

  // Tokens
  adminToken = await jwtSvc.signAdminToken();
  readOnlyToken = await jwtSvc.signDbToken("project1", ["read"]);
});

afterAll(async () => {
  await server.close();
  vi.unstubAllEnvs();
});

/** Produces a buffer with the correct magic bytes prefix for a given MIME type. */
function makeMagicBuffer(mime: string): Buffer {
  const magicMap: Record<string, number[]> = {
    "image/jpeg": [0xFF, 0xD8, 0xFF, 0xE0],
    "image/png":  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    "image/gif":  [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    "image/bmp":  [0x42, 0x4D],
  };
  const magic = magicMap[mime] ?? [0xFF, 0xD8, 0xFF, 0xE0];
  return Buffer.concat([Buffer.from(magic), Buffer.from("fake-image-data")]);
}

function resetMocks(opts?: { fileMimetype?: string; noFile?: boolean }) {
  mockTaggedResults = [];
  mockUnsafeResults = [];
  if (opts?.noFile) {
    mockFileFactory = () => Promise.resolve(null);
  } else {
    const mime = opts?.fileMimetype ?? "image/jpeg";
    // magic bytes must match the MIME type — otherwise upload.ts magic check returns 415
    const buf = makeMagicBuffer(mime);
    mockFileFactory = () =>
      Promise.resolve({
        mimetype: mime,
        filename: "test.jpg",
        toBuffer: () => Promise.resolve(buf),
      });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /upload testleri
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /db/:database/:table/:column/upload", () => {
  it("valid image → 200 and returns metadata", async () => {
    resetMocks();
    // column check: photo_mime column does NOT exist
    mockTaggedResults = [[]];
    // UPDATE RETURNING id
    mockUnsafeResults = [[{ id: "42" }]];

    const boundary = "----TestBoundary";
    // Real JPEG magic bytes (FF D8 FF E0 ...) — required to pass the magic bytes check
    const jpegMagic = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
    const partHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
    );
    const partFooter = Buffer.from(`\r\n--${boundary}--`);
    const payload = Buffer.concat([partHeader, jpegMagic, partFooter]);

    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=42",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.updated).toBe(true);
    expect(body.table).toBe("products");
    expect(body.column).toBe("photo");
    expect(body.id).toBe("42");
    expect(body.mime).toBe("image/jpeg");
    expect(typeof body.size).toBe("number");
  });

  it("if a mime column exists, MIME is also updated → 200", async () => {
    resetMocks({ fileMimetype: "image/png" });
    // photo_mime column EXISTS
    mockTaggedResults = [[{ column_name: "photo_mime" }]];
    // UPDATE SET col=$1, col_mime=$2 RETURNING id
    mockUnsafeResults = [[{ id: "7" }]];

    const boundary = "----MimeBoundary";
    // Real PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) — required to pass the magic bytes check
    const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00]);
    const partHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="img.png"\r\nContent-Type: image/png\r\n\r\n`
    );
    const partFooter = Buffer.from(`\r\n--${boundary}--`);
    const payload = Buffer.concat([partHeader, pngMagic, partFooter]);

    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=7",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().mime).toBe("image/png");
  });

  it("missing ?id param → 400", async () => {
    resetMocks();

    const boundary = "----NoBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="x.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(400);
    // Fastify schema validation "querystring/id is required" or our own 400
    const body = res.json();
    expect(body.error ?? body.message).toBeTruthy();
  });

  it("invalid MIME type → 415", async () => {
    resetMocks({ fileMimetype: "text/plain" });

    const boundary = "----TextBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=1",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="doc.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `not an image\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(415);
    expect(res.json().error).toMatch(/unsupported media type/i);
  });

  it("row not found → 404", async () => {
    resetMocks();
    // no mime column
    mockTaggedResults = [[]];
    // UPDATE RETURNING → empty
    mockUnsafeResults = [[]];

    const boundary = "----NotFoundBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=9999",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="photo.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/row not found/i);
  });

  it("auth olmadan → 401", async () => {
    resetMocks();

    const boundary = "----AuthBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=1",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="x.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("token without write scope → 403", async () => {
    resetMocks();

    const boundary = "----ReadBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/products/photo/upload?id=1",
      headers: {
        Authorization: `Bearer ${readOnlyToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="x.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(403);
  });

  it("invalid table name → 400", async () => {
    resetMocks();

    const boundary = "----BadTableBoundary";
    const res = await server.inject({
      method: "POST",
      url: "/db/project1/123invalid/photo/upload?id=1",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload:
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="x.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n` +
        `data\r\n` +
        `--${boundary}--`,
    });

    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /raw testleri
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /db/:database/:table/:id/:column/raw", () => {
  it("mime column exists → 200, correct Content-Type", async () => {
    resetMocks();
    // photo_mime EXISTS
    mockTaggedResults = [[{ column_name: "photo_mime" }]];
    mockUnsafeResults = [[{ photo: fakeBuffer, photo_mime: "image/png" }]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/42/photo/raw",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload).toBeInstanceOf(Buffer);
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it("no mime column + ?mime fallback → 200, fallback Content-Type", async () => {
    resetMocks();
    mockTaggedResults = [[]];
    mockUnsafeResults = [[{ photo: fakeBuffer }]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/42/photo/raw?mime=image/jpeg",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("no mime column + no ?mime → application/octet-stream", async () => {
    resetMocks();
    mockTaggedResults = [[]];
    mockUnsafeResults = [[{ photo: fakeBuffer }]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/42/photo/raw",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
  });

  it("row not found → 404", async () => {
    resetMocks();
    mockTaggedResults = [[]];
    mockUnsafeResults = [[]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/9999/photo/raw",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/row not found/i);
  });

  it("bytea column is null → 404", async () => {
    resetMocks();
    mockTaggedResults = [[]];
    mockUnsafeResults = [[{ photo: null }]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/5/photo/raw",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/no image data/i);
  });

  it("invalid table name → 400", async () => {
    resetMocks();

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/drop--table/42/photo/raw",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("without auth → 401", async () => {
    resetMocks();

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/42/photo/raw",
    });

    expect(res.statusCode).toBe(401);
  });

  it("Cache-Control header var", async () => {
    resetMocks();
    mockTaggedResults = [[]];
    mockUnsafeResults = [[{ photo: fakeBuffer }]];

    const res = await server.inject({
      method: "GET",
      url: "/db/project1/products/42/photo/raw?mime=image/webp",
      headers: { Authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=3600");
  });
});
