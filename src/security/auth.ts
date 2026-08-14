import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";

export interface AuthConfigFile {
  token?: string;
}

function readConfigFile(): AuthConfigFile {
  const path = join(homedir(), ".project-visualizer", "config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AuthConfigFile;
  } catch {
    return {};
  }
}

// Precedence: --token flag > PROJECT_VISUALIZER_TOKEN env var > ~/.project-visualizer/config.json.
// Undefined at every level means local mode — every caller must treat that as "no auth", identical
// to today's default behavior (nothing changes for existing local usage).
export function resolveAuthToken(cliToken?: string): string | undefined {
  if (cliToken) return cliToken;
  if (process.env.PROJECT_VISUALIZER_TOKEN) return process.env.PROJECT_VISUALIZER_TOKEN;
  return readConfigFile().token;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths — a length check up front is itself safe (it
  // leaks only the length of a secret whose length isn't the secret part).
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// No-op middleware when `token` is undefined (local mode). Otherwise requires
// `Authorization: Bearer <token>`, constant-time compared, 401 on anything else.
export function authMiddleware(token: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!token) return next();
    const header = req.header("authorization") ?? "";
    const [scheme, value] = header.split(" ");
    if (scheme === "Bearer" && value && safeEqual(value, token)) return next();
    res.status(401).json({ error: "unauthorized" });
  };
}
