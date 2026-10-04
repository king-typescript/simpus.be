import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const BOOK_COVER_MAX_BYTES = 5 * 1024 * 1024;
export const BOOK_COVER_UPLOAD_DIRECTORY = path.join(
  process.cwd(),
  "public",
  "uploads",
  "cover",
);
export const BOOK_COVER_UPLOAD_URL_PREFIX = "/uploads/cover";

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

export async function saveBookCover(bytes: Uint8Array, image: BookCoverImage) {
  const filename = `${randomUUID()}.${image.extension}`;
  const filePath = path.join(BOOK_COVER_UPLOAD_DIRECTORY, filename);
  const url = `${BOOK_COVER_UPLOAD_URL_PREFIX}/${filename}`;

  await mkdir(BOOK_COVER_UPLOAD_DIRECTORY, { recursive: true });

  let fileCreated = false;
  try {
    await writeFile(filePath, bytes, { flag: "wx", mode: 0o644 });
    fileCreated = true;
    return { url, contentType: image.contentType, size: bytes.byteLength };
  } catch (error) {
    if (fileCreated) {
      await unlink(filePath).catch(() => undefined);
    }
    throw error;
  }
}

const localCoverUrlPattern = /^\/uploads\/cover\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/i;

export function getBookCoverFilePath(url: string | null | undefined) {
  if (!url || !localCoverUrlPattern.test(url)) return null;
  return path.join(BOOK_COVER_UPLOAD_DIRECTORY, path.basename(url));
}

export async function deleteBookCover(url: string | null | undefined) {
  const filePath = getBookCoverFilePath(url);
  if (filePath) await unlink(filePath).catch(() => undefined);
}
