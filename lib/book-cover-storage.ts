import "server-only";

import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { getRustFsClient, getRustFsConfig } from "@/lib/rustfs";
import { isUuid } from "@/lib/validation";

export const BOOK_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const BOOK_COVER_KEY_PREFIX = "book-covers";

export type BookCoverImage = {
  extension: "jpg" | "png" | "webp";
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array) {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50;
}

export function detectBookCoverImage(bytes: Uint8Array): BookCoverImage | null {
  if (isJpeg(bytes)) return { extension: "jpg", contentType: "image/jpeg" };
  if (isPng(bytes)) return { extension: "png", contentType: "image/png" };
  if (isWebp(bytes)) return { extension: "webp", contentType: "image/webp" };
  return null;
}

function getBookCoverKey(image: BookCoverImage, schoolId: string) {
  if (!isUuid(schoolId)) throw new Error("schoolId tidak valid.");
  return `schools/${schoolId}/${BOOK_COVER_KEY_PREFIX}/${randomUUID()}.${image.extension}`;
}

export async function saveBookCover(bytes: Uint8Array, image: BookCoverImage, schoolId: string) {
  const key = getBookCoverKey(image, schoolId);
  const config = getRustFsConfig();

  await getRustFsClient().send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: image.contentType,
    CacheControl: "private, max-age=0, no-cache",
  }));

  return {
    key,
    contentType: image.contentType,
    size: bytes.byteLength,
  };
}

const bookCoverKeyPattern = /^schools\/[0-9a-f-]{36}\/book-covers\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i;

export function isBookCoverKey(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && bookCoverKeyPattern.test(value);
}

export async function deleteBookCover(key: string | null | undefined) {
  if (!isBookCoverKey(key)) return;

  const config = getRustFsConfig();

  await getRustFsClient().send(new DeleteObjectCommand({
    Bucket: config.bucket,
    Key: key,
  }));
}
