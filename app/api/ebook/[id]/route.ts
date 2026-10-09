import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextResponse } from "next/server";

import { noStoreHeaders, requireLibrarian } from "@/lib/auth";
import {
  assertEbookSize,
  deleteEbook,
  detectEbookFile,
  saveEbookFile,
  validateEpubFile,
} from "@/lib/ebook-storage";
import { prisma } from "@/lib/prisma";
import { getClientIp, hasOnlyFields, isJsonContentType, isRecord, isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders });
}

function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error
    && typeof error.code === "string" ? error.code : null;
}

function jsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function safeFileName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:"*?<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 255);
}

async function prepareUpload(file: File) {
  const fileName = safeFileName(file.name);
  if (!fileName) throw new Error("INVALID_FILE_NAME");

  assertEbookSize(file.size);
  const directory = join(tmpdir(), "simpus-satak-ebooks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = join(directory, `${randomUUID()}.upload`);

  try {
    await pipeline(
      Readable.fromWeb(file.stream() as import("node:stream/web").ReadableStream),
      createWriteStream(filePath, { mode: 0o600 }),
    );

    const extension = fileName.toLowerCase().split(".").pop();
    let detected: Awaited<ReturnType<typeof detectEbookFile>> = null;

    if (extension === "epub") {
      if (await validateEpubFile(filePath)) {
        detected = { extension: "epub", contentType: "application/epub+zip" };
      }
    } else {
      const header = Buffer.alloc(5);
      const handle = await open(filePath, "r");
      try {
        await handle.read(header, 0, header.length, 0);
      } finally {
        await handle.close();
      }
      detected = await detectEbookFile(header, fileName);
    }

    if (!detected) throw new Error("INVALID_FILE");
    return { filePath, fileName, detected };
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function audit(
  userId: string,
  request: Request,
  entityId: string,
  action: string,
  newData: unknown,
) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType: "Ebook",
      entityId,
      newData: jsonValue(newData),
      ipAddress: getClientIp(request),
    },
  });
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID e-book tidak valid.", 422);

  const ebook = await prisma.ebook.findUnique({
    where: { id, schoolId: auth.schoolId },
    select: {
      id: true,
      bookId: true,
      fileName: true,
      contentType: true,
      fileSize: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      book: { select: { id: true, title: true, isActive: true } },
    },
  });

  if (!ebook) return errorResponse("E-book tidak ditemukan.", 404);

  return NextResponse.json({
    data: { ...ebook, fileSize: ebook.fileSize.toString() },
  }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID e-book tidak valid.", 422);

  const current = await prisma.ebook.findUnique({
    where: { id, schoolId: auth.schoolId },
    select: { id: true, fileKey: true, status: true },
  });
  if (!current) return errorResponse("E-book tidak ditemukan.", 404);

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (isJsonContentType(request)) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Body JSON tidak valid.", 400);
    }

    if (!isRecord(body) || !hasOnlyFields(body, ["status"], true)) {
      return errorResponse("Body request tidak valid.", 422);
    }

    const status = body.status;
    if (status !== "AKTIF" && status !== "NONAKTIF") {
      return errorResponse("Status e-book tidak valid.", 422);
    }

    const updated = await prisma.ebook.update({
      where: { id, schoolId: auth.schoolId },
      data: { status },
      select: {
        id: true,
        bookId: true,
        fileName: true,
        contentType: true,
        fileSize: true,
        status: true,
        updatedAt: true,
      },
    });

    await audit(auth.user.id, request, id, "UPDATE", {
      action: "STATUS_CHANGE",
      oldStatus: current.status,
      status: updated.status,
    });

    return NextResponse.json({
      data: { ...updated, fileSize: updated.fileSize.toString() },
    }, { headers: noStoreHeaders });
  }

  if (!contentType.startsWith("multipart/form-data")) {
    return errorResponse("Content-Type harus application/json atau multipart/form-data.", 415);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("Form upload tidak valid.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return errorResponse("File wajib diisi.", 422);

  let upload: Awaited<ReturnType<typeof prepareUpload>>;
  try {
    upload = await prepareUpload(file);
  } catch (error) {
    const message = error instanceof Error && error.message === "INVALID_FILE_NAME"
      ? "Nama file tidak valid."
      : "File harus berupa PDF atau EPUB yang valid.";
    return errorResponse(message, 422);
  }

  let saved: Awaited<ReturnType<typeof saveEbookFile>> | null = null;
  try {
    saved = await saveEbookFile(upload.filePath, upload.fileName, upload.detected, auth.schoolId);
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.ebook.update({
        where: { id, schoolId: auth.schoolId },
        data: {
          fileKey: saved!.key,
          fileName: saved!.fileName,
          contentType: saved!.contentType,
          fileSize: BigInt(saved!.size),
        },
        select: {
          id: true,
          bookId: true,
          fileName: true,
          contentType: true,
          fileSize: true,
          status: true,
          updatedAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          schoolId: auth.schoolId,
          userId: auth.user.id,
          action: "UPDATE",
          entityType: "Ebook",
          entityId: id,
          newData: jsonValue({ action: "FILE_REPLACE", oldFileKey: current.fileKey, fileName: result.fileName, contentType: result.contentType, fileSize: result.fileSize.toString() }),
          ipAddress: getClientIp(request),
        },
      });
      return result;
    });

    await deleteEbook(current.fileKey).catch(() => undefined);
    return NextResponse.json({
      data: { ...updated, fileSize: updated.fileSize.toString() },
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (saved) await deleteEbook(saved.key).catch(() => undefined);
    if (prismaCode(error) === "P2025") return errorResponse("E-book tidak ditemukan.", 404);
    return errorResponse("Gagal memperbarui e-book.", 500);
  } finally {
    await rm(upload.filePath, { force: true }).catch(() => undefined);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await requireLibrarian();
  if (!auth.ok) return errorResponse("Tidak memiliki akses.", auth.status);

  const { id } = await context.params;
  if (!isUuid(id)) return errorResponse("ID e-book tidak valid.", 422);

  const current = await prisma.ebook.findUnique({
    where: { id, schoolId: auth.schoolId },
    select: { id: true, fileKey: true, status: true },
  });
  if (!current) return errorResponse("E-book tidak ditemukan.", 404);

  if (current.status === "NONAKTIF") {
    return NextResponse.json({ data: { id, status: current.status } }, { headers: noStoreHeaders });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.ebook.update({
      where: { id, schoolId: auth.schoolId },
      data: { status: "NONAKTIF" },
      select: { id: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        schoolId: auth.schoolId,
          userId: auth.user.id,
        action: "UPDATE",
        entityType: "Ebook",
        entityId: id,
        newData: jsonValue({ action: "SOFT_DELETE", oldStatus: current.status, status: result.status }),
        ipAddress: getClientIp(request),
      },
    });
    return result;
  });

  return NextResponse.json({ data: updated }, { headers: noStoreHeaders });
}
