import "server-only";

import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import unzipper from "unzipper";
import { XMLParser } from "fast-xml-parser";
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
import { isUuid } from "@/lib/validation";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_PRESIGNED_URL_TTL = 5 * 60;
const MAX_PRESIGNED_URL_TTL = 15 * 60;
const EBOOK_KEY_PREFIX = "ebooks";
const SCHOOL_KEY_PREFIX = "schools";
const EPUB_MAX_ENTRIES = 2_000;
const EPUB_MAX_ENTRY_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const EPUB_MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const EPUB_MIMETYPE = "application/epub+zip";
const EPUB_CONTAINER_PATH = "META-INF/container.xml";

const epubXmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
  allowBooleanAttributes: false,
});

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

function isSafeEpubPath(path: string): boolean {
  return path.length > 0
    && !path.startsWith("/")
    && !path.includes("\\")
    && !path.split("/").includes("..")
    && !path.includes("\0");
}

async function validateEpubFilePath(filePath: string): Promise<boolean> {
  let parser: unzipper.ParseStream;
  try {
    parser = createReadStream(filePath).pipe(unzipper.Parse({ forceStream: true }));
  } catch {
    return false;
  }

  const entries = new Set<string>();
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  let mimetypeContent: Buffer | null = null;
  let mimetypeMethod: number | null = null;
  let containerContent: Buffer | null = null;

  try {
    for await (const entry of parser) {
      entryCount += 1;
      if (entryCount > EPUB_MAX_ENTRIES) return false;

      const path = entry.path;
      if (!isSafeEpubPath(path) || entries.has(path) || entry.type === "Directory") {
        entry.autodrain();
        return false;
      }
      entries.add(path);

      if (entry.vars.flags & 0x1) {
        entry.autodrain();
        return false;
      }

      const uncompressedSize = Number(entry.vars.uncompressedSize);
      const compressedSize = Number(entry.vars.compressedSize);
      if (
        !Number.isSafeInteger(uncompressedSize)
        || !Number.isSafeInteger(compressedSize)
        || uncompressedSize > EPUB_MAX_ENTRY_UNCOMPRESSED_BYTES
        || (compressedSize > 0 && uncompressedSize / compressedSize > 1000)
      ) {
        entry.autodrain();
        return false;
      }

      totalUncompressedBytes += uncompressedSize;
      if (totalUncompressedBytes > EPUB_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        entry.autodrain();
        return false;
      }

      if (path === "mimetype") {
        mimetypeMethod = entry.vars.compressionMethod;
        mimetypeContent = await entry.buffer();
      } else if (path === EPUB_CONTAINER_PATH) {
        containerContent = await entry.buffer();
      } else {
        entry.autodrain();
      }
    }
  } catch {
    return false;
  }

  if (
    !mimetypeContent
    || mimetypeMethod !== 0
    || mimetypeContent.toString("utf8") !== EPUB_MIMETYPE
    || !containerContent
  ) return false;

  let containerXml: unknown;
  try {
    containerXml = epubXmlParser.parse(containerContent.toString("utf8"));
  } catch {
    return false;
  }

  const rootfiles = (containerXml as {
    container?: { rootfiles?: { rootfile?: unknown } };
  }).container?.rootfiles?.rootfile;
  const rootfileList = Array.isArray(rootfiles) ? rootfiles : [rootfiles];
  if (!rootfiles) return false;

  return rootfileList.some((rootfile) => {
    if (typeof rootfile !== "object" || rootfile === null) return false;
    const fullPath = (rootfile as { ["@_full-path"]?: unknown })["@_full-path"];
    return typeof fullPath === "string" && isSafeEpubPath(fullPath) && entries.has(fullPath);
  });
}

export async function validateEpubFile(filePath: string): Promise<boolean> {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size > readMaxFileBytes()) return false;
    return validateEpubFilePath(filePath);
  } catch {
    return false;
  }
}

export async function detectEbookFile(
  bytes: Uint8Array,
  fileName: string,
): Promise<EbookUpload | null> {
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "pdf" && isPdf(bytes)) {
    return { extension: "pdf", contentType: EBOOK_CONTENT_TYPES.PDF };
  }
  if (extension === "epub" && isZip(bytes)) {
    return { extension: "epub", contentType: EBOOK_CONTENT_TYPES.EPUB };
  }
  return null;
}

function getEbookKey(file: EbookUpload, schoolId: string): string {
  if (!isUuid(schoolId)) throw new Error("schoolId tidak valid.");
  return `${SCHOOL_KEY_PREFIX}/${schoolId}/${EBOOK_KEY_PREFIX}/${randomUUID()}.${file.extension}`;
}

const ebookKeyPattern = /^schools\/[0-9a-f-]{36}\/ebooks\/[0-9a-f-]{36}\.(?:pdf|epub)$/i;

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

export async function saveEbookFile(
  filePath: string,
  fileName: string,
  file: EbookUpload,
  schoolId: string,
): Promise<SavedEbook> {
  const fileStats = await stat(filePath);
  assertEbookSize(fileStats.size);

  const key = getEbookKey(file, schoolId);
  await getRustFsClient().send(new PutObjectCommand({
    Bucket: readEbookBucket(),
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: fileStats.size,
    ContentType: file.contentType,
    ContentDisposition: "inline",
    CacheControl: "private, no-store",
    Metadata: { filetype: file.extension },
  }));

  return {
    key,
    fileName,
    contentType: file.contentType,
    size: fileStats.size,
  };
}

export async function saveEbook(
  bytes: Uint8Array,
  fileName: string,
  file: EbookUpload,
  schoolId: string,
): Promise<SavedEbook> {
  assertEbookSize(bytes.byteLength);

  const key = getEbookKey(file, schoolId);
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

  return { key, fileName, contentType: file.contentType, size: bytes.byteLength };
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
