import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authMiddleware, resolveAuthToken } from "./auth.js";

describe("resolveAuthToken", () => {
  const originalEnv = process.env.PROJECT_VISUALIZER_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PROJECT_VISUALIZER_TOKEN;
    else process.env.PROJECT_VISUALIZER_TOKEN = originalEnv;
  });

  it("prefers the explicit CLI token over the env var", () => {
    process.env.PROJECT_VISUALIZER_TOKEN = "env-token";
    expect(resolveAuthToken("cli-token")).toBe("cli-token");
  });

  it("falls back to the env var when no CLI token is given", () => {
    process.env.PROJECT_VISUALIZER_TOKEN = "env-token";
    expect(resolveAuthToken(undefined)).toBe("env-token");
  });

  it("returns undefined (local mode) when nothing is configured", () => {
    delete process.env.PROJECT_VISUALIZER_TOKEN;
    expect(resolveAuthToken(undefined)).toBeUndefined();
  });
});

describe("authMiddleware", () => {
  function mockReqRes(authHeader?: string) {
    const req = { header: (name: string) => (name.toLowerCase() === "authorization" ? authHeader : undefined) } as never;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as never;
    const next = vi.fn();
    return { req, res: res as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }, next };
  }

  it("is a no-op (always calls next) when no token is configured — local mode unchanged", () => {
    const { req, res, next } = mockReqRes();
    authMiddleware(undefined)(req, res as never, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects with 401 when a token is configured but no Authorization header is sent", () => {
    const { req, res, next } = mockReqRes();
    authMiddleware("secret")(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects with 401 for a wrong Bearer token", () => {
    const { req, res, next } = mockReqRes("Bearer wrong-token");
    authMiddleware("secret")(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next for the correct Bearer token", () => {
    const { req, res, next } = mockReqRes("Bearer secret");
    authMiddleware("secret")(req, res as never, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
