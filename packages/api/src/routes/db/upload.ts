/**
 * Image upload routes — using a PostgreSQL bytea column.
 *
 *   POST /db/:database/:table/:column/upload  — Accept a multipart file, write as bytea
 *   GET  /db/:database/:table/:id/:column/raw — Read bytea, serve as an image
 *
 * Usage example:
 *   1. Create a bytea column in your table:
 *      ALTER TABLE products ADD COLUMN photo bytea;
 *      ALTER TABLE products ADD COLUMN photo_mime text;   -- optional, recommended
 *
 *   2. Upload:
 *      POST /db/mydb/products/photo/upload?id=42
 *      Content-Type: multipart/form-data  (file field name: "file")
 *
 *   3. Retrieve:
 *      GET /db/mydb/products/42/photo/raw
 *      → returns binary image, Content-Type: image/jpeg (or from the photo_mime column)
 */

import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { scopeGuard } from "../../middleware/scopeGuard.js";
import { assertIdentifier } from "../../utils/identifier.js";

/**
 * Magic bytes (file signature) table.
 * Defines the leading byte sequences for each MIME type.
 * Multiple signatures are supported (e.g. JPEG can start with several different byte patterns).
 */
const MAGIC_BYTES: Record<string, Uint8Array[]> = {
  "image/jpeg": [
    new Uint8Array([0xFF, 0xD8, 0xFF]),
  ],
  "image/png": [
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  ],
  "image/webp": [
    // RIFF....WEBP — byte 0-3 = RIFF, byte 8-11 = WEBP
    new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  ],
  "image/gif": [
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
  ],
  "image/bmp": [
    new Uint8Array([0x42, 0x4D]),
  ],
  "image/tiff": [
    new Uint8Array([0x49, 0x49, 0x2A, 0x00]), // little-endian
    new Uint8Array([0x4D, 0x4D, 0x00, 0x2A]), // big-endian
  ],
  // SVG: XML-based — no magic bytes; only text content is checked
  "image/svg+xml": [],
};

/**
 * Checks whether the leading bytes of a Buffer match the expected magic bytes.
 * No signature check is performed for text-based formats such as SVG (empty array → pass).
 */
function isValidMagicBytes(buffer: Buffer, mime: string): boolean {
  const signatures = MAGIC_BYTES[mime];

  // Known MIME type but empty signature list (SVG) → pass
  if (signatures !== undefined && signatures.length === 0) return true;

  // MIME type not in table → reject
  if (!signatures) return false;

  // WebP special case: RIFF header + WEBP check at offset 8
  if (mime === "image/webp") {
    if (buffer.length < 12) return false;
    const riff = buffer.slice(0, 4);
    const webp = buffer.slice(8, 12);
    return (
      riff[0] === 0x52 && riff[1] === 0x49 && riff[2] === 0x46 && riff[3] === 0x46 &&
      webp[0] === 0x57 && webp[1] === 0x45 && webp[2] === 0x42 && webp[3] === 0x50
    );
  }

  // General prefix comparison
  return signatures.some((sig) => {
    if (buffer.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
      if (buffer[i] !== sig[i]) return false;
    }
    return true;
  });
}

/** Allowed MIME types */
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
]);

/** Default maximum file size: 10 MB */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function uploadRoute(server: FastifyInstance) {
  // @fastify/multipart is registered only for this scope.
  // Not registered globally — does not affect the JSON body parser.
  await server.register(multipart, {
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: 1, // tek dosya
    },
  });

  // ── POST /:database/:table/:column/upload ─────────────────────────────────
  server.post(
    "/:database/:table/:column/upload",
    {
      preHandler: [scopeGuard("write")],
      schema: {
        description:
          "Upload an image file into a bytea column of a table row. " +
          "Requires ?id=<row_id> query param. " +
          "If a <column>_mime column exists, MIME type is also persisted there.",
        tags: ["images"],
        consumes: ["multipart/form-data"],
        params: {
          type: "object",
          required: ["database", "table", "column"],
          properties: {
            database: { type: "string" },
            table: { type: "string" },
            column: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "Primary key value of the target row" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              updated: { type: "boolean" },
              table: { type: "string" },
              column: { type: "string" },
              id: { type: "string" },
              mime: { type: "string" },
              size: { type: "integer" },
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, column } = req.params as {
        table: string;
        column: string;
      };
      assertIdentifier(table, "table");
      assertIdentifier(column, "column");

      const query = req.query as { id?: string };
      if (!query.id) {
        return reply.status(400).send({
          error: "Missing required query param: id",
          message: "Provide ?id=<row_id> to identify the target row",
        });
      }
      const rowId = query.id;

      // Read the multipart file
      let fileData: multipart.MultipartFile;
      try {
        const part = await req.file();
        if (!part) {
          return reply.status(400).send({
            error: "No file uploaded",
            message: "Send a file field named 'file' as multipart/form-data",
          });
        }
        fileData = part;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.message.includes("Request file too large")
        ) {
          return reply.status(413).send({
            error: "File too large",
            message: `Maximum allowed size is ${MAX_FILE_SIZE / 1024 / 1024}MB`,
          });
        }
        throw err;
      }

      const mime = fileData.mimetype;
      if (!ALLOWED_MIME.has(mime)) {
        // Drain the stream, otherwise the connection hangs
        await fileData.toBuffer().catch(() => undefined);
        return reply.status(415).send({
          error: "Unsupported media type",
          message: `Allowed MIME types: ${[...ALLOWED_MIME].join(", ")}`,
          received: mime,
        });
      }

      // Read the entire file into memory
      const buffer = await fileData.toBuffer();

      // Magic bytes check — do not trust the client Content-Type header.
      // An attacker could upload a PHP/shell file with an image/jpeg header.
      // Compare the leading bytes against the actual format.
      if (!isValidMagicBytes(buffer, mime)) {
        return reply.status(415).send({
          error: "File content does not match declared MIME type",
          message: "Upload rejected: file magic bytes do not match the Content-Type header.",
        });
      }

      const sql = server.poolManager.getPool(dbName);

      // Check if a <column>_mime column exists — if so, also write the MIME type
      const mimeColumn = `${column}_mime`;
      const [colCheck] = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = ${table}
          AND column_name = ${mimeColumn}
        LIMIT 1
      `;
      const hasMimeCol = Boolean(colCheck);

      let updateResult: unknown[];
      if (hasMimeCol) {
        updateResult = await sql.unsafe(
          `UPDATE "${table}"
           SET "${column}" = $1, "${mimeColumn}" = $2
           WHERE id = $3
           RETURNING id`,
          [buffer, mime, rowId]
        );
      } else {
        updateResult = await sql.unsafe(
          `UPDATE "${table}"
           SET "${column}" = $1
           WHERE id = $2
           RETURNING id`,
          [buffer, rowId]
        );
      }

      if (!Array.isArray(updateResult) || updateResult.length === 0) {
        return reply.status(404).send({
          error: "Row not found",
          message: `No row with id=${rowId} in table '${table}'`,
        });
      }

      // Row cache'ini invalidate et
      await server.cache.invalidatePattern(
        server.cache.buildKey(dbName, "rows", table, "*")
      );

      return reply.send({
        updated: true,
        table,
        column,
        id: rowId,
        mime,
        size: buffer.length,
      });
    })
  );

  // ── GET /:database/:table/:id/:column/raw ─────────────────────────────────
  server.get(
    "/:database/:table/:id/:column/raw",
    {
      preHandler: [scopeGuard("read")],
      schema: {
        description:
          "Serve the raw binary content of a bytea column as an image. " +
          "MIME type is read from <column>_mime column if it exists, " +
          "otherwise falls back to ?mime query param (default: application/octet-stream).",
        tags: ["images"],
        params: {
          type: "object",
          required: ["database", "table", "id", "column"],
          properties: {
            database: { type: "string" },
            table: { type: "string" },
            id: { type: "string" },
            column: { type: "string" },
          },
        },
        querystring: {
          type: "object",
          properties: {
            mime: {
              type: "string",
              description:
                "MIME type fallback when <column>_mime column does not exist (e.g. image/jpeg)",
            },
          },
        },
      },
    },
    asyncHandler(async (req, reply) => {
      const dbName = req.dbName!;
      const { table, id, column } = req.params as {
        table: string;
        id: string;
        column: string;
      };
      assertIdentifier(table, "table");
      assertIdentifier(column, "column");

      const query = req.query as { mime?: string };

      const sql = server.poolManager.getPool(dbName);

      // Does a <column>_mime column exist?
      const mimeColumn = `${column}_mime`;
      const [colCheck] = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = ${table}
          AND column_name = ${mimeColumn}
        LIMIT 1
      `;
      const hasMimeCol = Boolean(colCheck);

      let row: Record<string, unknown> | undefined;
      if (hasMimeCol) {
        const [r] = await sql.unsafe(
          `SELECT "${column}", "${mimeColumn}" FROM "${table}" WHERE id = $1 LIMIT 1`,
          [id]
        );
        row = r as Record<string, unknown> | undefined;
      } else {
        const [r] = await sql.unsafe(
          `SELECT "${column}" FROM "${table}" WHERE id = $1 LIMIT 1`,
          [id]
        );
        row = r as Record<string, unknown> | undefined;
      }

      if (!row) {
        return reply.status(404).send({
          error: "Row not found",
          message: `No row with id=${id} in table '${table}'`,
        });
      }

      const imageData = row[column];
      if (imageData === null || imageData === undefined) {
        return reply.status(404).send({
          error: "No image data",
          message: `Column '${column}' is null for row id=${id}`,
        });
      }

      // Determine MIME type: DB column > query param > fallback
      const mimeFromDb = hasMimeCol
        ? (row[mimeColumn] as string | null)
        : null;
      const mime =
        mimeFromDb ?? query.mime ?? "application/octet-stream";

      // bytea → Buffer
      const buffer =
        imageData instanceof Buffer
          ? imageData
          : Buffer.from(imageData as string, "hex");

      return reply
        .type(mime)
        .header("Content-Length", String(buffer.length))
        .header("Cache-Control", "public, max-age=3600")
        .send(buffer);
    })
  );
}
