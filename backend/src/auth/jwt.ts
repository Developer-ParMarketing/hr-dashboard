import { createHmac, timingSafeEqual } from "crypto";

export type JwtPayload = {
  sub: number;
  email: string;
  name: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
};

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function signJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  ttlSec: number,
): string {
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const now = Math.floor(Date.now() / 1000);
  const body = b64urlJson({ ...payload, iat: now, exp: now + ttlSec });
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid token");
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new Error("invalid token");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as JwtPayload;
  if (!payload?.sub || !payload.jti || !payload.exp) throw new Error("invalid token");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("expired token");
  return payload;
}
