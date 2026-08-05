/**
 * asyncHandler utility testleri.
 */

import { describe, it, expect, vi } from "vitest";
import { asyncHandler } from "../../src/utils/asyncHandler.js";
import type { FastifyRequest, FastifyReply } from "fastify";

function mockReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
  return reply;
}

function mockRequest() {
  return {} as FastifyRequest;
}

describe("asyncHandler", () => {
  it("başarılı handler'ı çağırır", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = asyncHandler(handler);
    const req = mockRequest();
    const reply = mockReply();

    await wrapped(req, reply);
    expect(handler).toHaveBeenCalledWith(req, reply);
  });

  it("hata fırlatınca 500 döner", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "boom" });
  });

  it("'does not exist' hatası 404 döner", async () => {
    const handler = vi.fn().mockRejectedValue(new Error('relation "foo" does not exist'));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it("'duplicate key' hatası 409 döner", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(409);
  });

  it("'Invalid' ile başlayan hata 400 döner", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Invalid column name: drop"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });
});