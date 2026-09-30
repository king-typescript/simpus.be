#!/bin/sh
set -e

# Jalankan migrasi Prisma secara otomatis jika RUN_MIGRATION aktif (default: true)
if [ "${RUN_MIGRATION:-true}" = "true" ]; then
  echo "==> [SIMPUS] Menjalankan Prisma migrate deploy..."
  pnpm prisma migrate deploy
  echo "==> [SIMPUS] Migrasi database berhasil diaplikasikan."
fi

exec "$@"
