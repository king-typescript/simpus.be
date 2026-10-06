import "server-only";

import { S3Client } from "@aws-sdk/client-s3";

const MAX_REGION_LENGTH = 100;
const MAX_BUCKET_LENGTH = 63;

export type RustFsConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

let internalClient: S3Client | undefined;
let presigningClient: S3Client | undefined;

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} harus diatur.`);
  }

  return value;
}

function parseEndpoint(rawEndpoint: string, name: string): string {
  let endpoint: URL;

  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error(`${name} harus berupa URL yang valid.`);
  }

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error(`${name} harus menggunakan HTTP atau HTTPS.`);
  }

  if (!endpoint.hostname) {
    throw new Error(`${name} harus memiliki hostname.`);
  }

  return endpoint.toString().replace(/\/$/, "");
}

function readEndpoint(): string {
  return parseEndpoint(readRequiredEnv("RUSTFS_ENDPOINT"), "RUSTFS_ENDPOINT");
}

function readPublicEndpoint(): string {
  return parseEndpoint(
    readRequiredEnv("RUSTFS_PUBLIC_ENDPOINT"),
    "RUSTFS_PUBLIC_ENDPOINT",
  );
}

function readRegion(): string {
  const region = process.env.RUSTFS_REGION?.trim() || "us-east-1";

  if (region.length > MAX_REGION_LENGTH || !/^[a-z0-9][a-z0-9-]*$/.test(region)) {
    throw new Error("RUSTFS_REGION tidak valid.");
  }

  return region;
}

function readBucket(): string {
  const bucket = readRequiredEnv("RUSTFS_BUCKET");

  if (
    bucket.length < 3
    || bucket.length > MAX_BUCKET_LENGTH
    || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket)
    || bucket.includes("..")
    || /^\d+\.\d+\.\d+\.\d+$/.test(bucket)
  ) {
    throw new Error("RUSTFS_BUCKET tidak valid.");
  }

  return bucket;
}

export function getRustFsConfig(): RustFsConfig {
  return {
    endpoint: readEndpoint(),
    region: readRegion(),
    bucket: readBucket(),
    accessKeyId: readRequiredEnv("RUSTFS_ACCESS_KEY"),
    secretAccessKey: readRequiredEnv("RUSTFS_SECRET_KEY"),
  };
}

function createClient(endpoint: string): S3Client {
  const config = getRustFsConfig();

  return new S3Client({
    endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function getRustFsClient(): S3Client {
  if (!internalClient) {
    internalClient = createClient(readEndpoint());
  }

  return internalClient;
}

export function getRustFsPresigningClient(): S3Client {
  if (!presigningClient) {
    presigningClient = createClient(readPublicEndpoint());
  }

  return presigningClient;
}
