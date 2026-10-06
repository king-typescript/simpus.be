import "server-only";

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { isBookCoverKey } from "@/lib/book-cover-storage";
import {
  getRustFsConfig,
  getRustFsPresigningClient,
} from "@/lib/rustfs";

const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 60 * 60;

function getPresignedUrlTtl(): number {
  const rawValue = process.env.RUSTFS_PRESIGNED_URL_TTL?.trim();

  if (!rawValue) return DEFAULT_TTL_SECONDS;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error("RUSTFS_PRESIGNED_URL_TTL tidak valid.");
  }

  const ttl = Number(rawValue);
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    throw new Error("RUSTFS_PRESIGNED_URL_TTL harus antara 1 dan 3600 detik.");
  }

  return ttl;
}

function getContentType(key: string): "image/jpeg" | "image/png" | "image/webp" {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function getBookCoverUrl(
  key: string | null | undefined,
): Promise<string | null> {
  if (!key) return null;

  if (!isBookCoverKey(key)) {
    try {
      const externalUrl = new URL(key);
      return externalUrl.protocol === "https:" ? key : null;
    } catch {
      return null;
    }
  }

  const config = getRustFsConfig();
  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ResponseContentType: getContentType(key),
    ResponseContentDisposition: "inline",
  });

  return getSignedUrl(getRustFsPresigningClient(), command, {
    expiresIn: getPresignedUrlTtl(),
  });
}
