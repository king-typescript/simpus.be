import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_HASH_LENGTH = 64;

export type EbookAccessToken = {
  token: string;
  tokenHash: string;
};

export function createEbookAccessToken(): EbookAccessToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");

  return {
    token,
    tokenHash: hashEbookAccessToken(token),
  };
}

export function isValidEbookAccessToken(
  token: string | null | undefined,
): token is string {
  return typeof token === "string"
    && token.length === 43
    && /^[A-Za-z0-9_-]+$/.test(token);
}

export function hashEbookAccessToken(token: string): string {
  if (!isValidEbookAccessToken(token)) {
    throw new Error("Token akses e-book tidak valid.");
  }

  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isValidEbookAccessTokenHash(
  tokenHash: string | null | undefined,
): tokenHash is string {
  return typeof tokenHash === "string"
    && tokenHash.length === TOKEN_HASH_LENGTH
    && /^[a-f0-9]+$/i.test(tokenHash);
}

export function isSameEbookAccessToken(
  token: string,
  tokenHash: string,
): boolean {
  if (!isValidEbookAccessToken(token) || !isValidEbookAccessTokenHash(tokenHash)) {
    return false;
  }

  const actual = Buffer.from(hashEbookAccessToken(token), "hex");
  const expected = Buffer.from(tokenHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function extractBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  if (typeof authorizationHeader !== "string") return null;

  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  if (!match || !isValidEbookAccessToken(match[1])) return null;

  return match[1];
}
