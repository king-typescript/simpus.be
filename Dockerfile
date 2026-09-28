FROM node:22-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000
# Placeholder environment variables untuk tahap build Next.js (dioverride saat runtime)
ENV DATABASE_URL="postgresql://postgres:postgres@localhost:5432/simpus_db?schema=public"
ENV AUTH_SECRET="simpus_satak_secret_key_at_least_32_characters_long_123456"

# Install dependencies sistem yang dibutuhkan Prisma dan runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Aktifkan pnpm versi 12.6.0 sesuai konfigurasi packageManager di package.json
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

# Salin file konfigurasi paket untuk memanfaatkan layer cache Docker
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependensi menggunakan pnpm
RUN pnpm install --frozen-lockfile

# Salin seluruh kode aplikasi
COPY . .

# Pastikan script entrypoint menggunakan format UNIX dan memiliki izin eksekusi
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh \
  && chmod +x /app/docker-entrypoint.sh

# Generate Prisma Client
RUN pnpm prisma generate

# Build aplikasi Next.js
RUN pnpm build

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
