import "server-only";

import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  getRustFsClient,
  getRustFsPresigningClient,
} from "@/lib/rustfs";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_PRESIGNED_URL_TTL = 5 * 60;
const MAX_PRESIGNED_URL_TTL = 15 * 60;
const EBOOK_KEY_PREFIX = "ebooks";

export const EBOOK_CONTENT_TYPES = {
  PDF: "application/pdf",
  EPUB: "application/epub+zip",
} as const;

export type EbookUpload = {
  extension: "pdf" | "epub";
  contentType: (typeof EBOOK_CONTENT_TYPES)[keyof typeof EBOOK_CONTENT_TYPES];
};

export type SavedEbook = {
  key: string;
  fileName: string;
  contentType: EbookUpload["contentType"];
  size: number;
};

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} harus diatur.`);
  return value;
}

function readEbookBucket(): string {
  const bucket = readRequiredEnv("RUSTFS_EBOOK_BUCKET");

  if (
    bucket.length < 3
    || bucket.length > 63
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.includes("..")
    || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)
  ) {
    throw new Error("RUSTFS_EBOOK_BUCKET tidak valid.");
  }

  return bucket;
}

function readPositiveEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]?.trim();
  if (!rawValue) return fallback;
  if (!/^\d+$/.test(rawValue)) throw new Error(`${name} tidak valid.`);

  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} harus berupa bilangan positif.`);
  }

  return value;
}

function readMaxFileBytes(): number {
  return readPositiveEnv("RUSTFS_EBOOK_MAX_BYTES", DEFAULT_MAX_BYTES);
}

function readPresignedUrlTtl(): number {
  const value = readPositiveEnv(
    "RUSTFS_EBOOK_PRESIGNED_URL_TTL",
    DEFAULT_PRESIGNED_URL_TTL,
  );

  if (value > MAX_PRESIGNED_URL_TTL) {
    throw new Error(
      `RUSTFS_EBOOK_PRESIGNED_URL_TTL harus antara 1 dan ${MAX_PRESIGNED_URL_TTL} detik.`,
    );
  }

  return value;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && (
      (bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
}

export function detectEbookFile(
  bytes: Uint8Array,
  fileName: string,
): EbookUpload | null {
  const extension = fileName.toLowerCase().split(".").pop();

  if (extension === "pdf" && isPdf(bytes)) {
    return { extension: "pdf", contentType: EBOOK_CONTENT_TYPES.PDF };
  }

  if (extension === "epub" && isZip(bytes)) {
    return { extension: "epub", contentType: EBOOK_CONTENT_TYPES.EPUB };
  }

  return null;
}

function getEbookKey(file: EbookUpload): string {
  return `${EBOOK_KEY_PREFIX}/${randomUUID()}.${file.extension}`;
}

const ebookKeyPattern = /^ebooks\/[0-9a-f-]{36}\.(?:pdf|epub)$/i;

export function isEbookKey(value: string | null | undefined): value is string {
  return value !== null
    && value !== undefined
    && ebookKeyPattern.test(value);
}

export function assertEbookSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > readMaxFileBytes()) {
    throw new Error(
      `Ukuran e-book harus antara 1 byte dan ${readMaxFileBytes()} byte.`,
    );
  }
}

export async function saveEbook(
  bytes: Uint8Array,
  fileName: string,
  file: EbookUpload,
): Promise<SavedEbook> {
  assertEbookSize(bytes.byteLength);

  const key = getEbookKey(file);
  await getRustFsClient().send(new PutObjectCommand({
    Bucket: readEbookBucket(),
    Key: key,
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: file.contentType,
    ContentDisposition: "inline",
    CacheControl: "private, no-store",
    Metadata: { filetype: file.extension },
  }));

  return {
    key,
    fileName,
    contentType: file.contentType,
    size: bytes.byteLength,
  };
}

export async function getEbookFileMetadata(key: string) {
  if (!isEbookKey(key)) throw new Error("Key e-book tidak valid.");

  return getRustFsClient().send(new HeadObjectCommand({
    Bucket: readEbookBucket(),
    Key: key,
  }));
}

export async function getEbookFile(key: string, range?: string | null) {
  if (!isEbookKey(key)) throw new Error("Key e-book tidak valid.");

  return getRustFsClient().send(new GetObjectCommand({
    Bucket: readEbookBucket(),
    Key: key,
    Range: range || undefined,
    ResponseContentDisposition: "inline",
    ResponseCacheControl: "private, no-store",
    ResponseContentType: getEbookContentType(key),
  }));
}

export async function getEbookSignedUrl(key: string): Promise<string> {
  if (!isEbookKey(key)) throw new Error("Key e-book tidak valid.");

  return getSignedUrl(
    getRustFsPresigningClient(),
    new GetObjectCommand({
      Bucket: readEbookBucket(),
      Key: key,
      ResponseContentDisposition: "inline",
      ResponseCacheControl: "private, no-store",
      ResponseContentType: getEbookContentType(key),
    }),
    { expiresIn: readPresignedUrlTtl() },
  );
}

export async function deleteEbook(key: string | null | undefined): Promise<void> {
  if (!isEbookKey(key)) return;

  await getRustFsClient().send(new DeleteObjectCommand({
    Bucket: readEbookBucket(),
    Key: key,
  }));
}

function getEbookContentType(key: string) {
  return key.toLowerCase().endsWith(".epub")
    ? EBOOK_CONTENT_TYPES.EPUB
    : EBOOK_CONTENT_TYPES.PDF;
}
