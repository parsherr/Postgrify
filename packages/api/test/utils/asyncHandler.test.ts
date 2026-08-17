/**
 * asyncHandler utility tests.
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
  it("calls a successful handler", async () => {
    const handler = vi.fn().mockResolvedValue({ ok: true });
    const wrapped = asyncHandler(handler);
    const req = mockRequest();
    const reply = mockReply();

    await wrapped(req, reply);
    expect(handler).toHaveBeenCalledWith(req, reply);
  });

  it("returns 500 when the handler throws", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith({ error: "boom" });
  });

  it("returns 404 for a 'does not exist' error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error('relation "foo" does not exist'));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it("returns 409 for a 'duplicate key' error", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("duplicate key value violates unique constraint"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(409);
  });

  it("returns 400 for an error beginning with 'Invalid'", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("Invalid column name: drop"));
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("text search configuration does not exist → 400 (not 404)", async () => {
    const handler = vi.fn().mockRejectedValue(
      new Error('text search configuration "not_a_real_config" does not exist')
    );
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("syntax error in tsquery → 400", async () => {
    const handler = vi.fn().mockRejectedValue(
      new Error('syntax error in tsquery: "(((bad"')
    );
    const wrapped = asyncHandler(handler);
    const reply = mockReply();

    await wrapped(mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(400);
  });
});