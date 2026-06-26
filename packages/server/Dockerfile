# Production image for @badminton/server.
#
# IMPORTANT: build from the REPO ROOT so the npm-workspaces layout resolves.
#   docker build -f packages/server/Dockerfile -t badminton-server .
#
# This is a monorepo: the server depends on the workspace package
# @badminton/shared (packages/shared) which must be BUILT (tsc -> dist) so its
# package.json "main"/"types" (dist/index.js / dist/index.d.ts) resolve, and on
# Prisma whose client must be generated from packages/server/prisma/schema.prisma.
#
# Strategy: build everything in a builder stage with the full workspace and dev
# deps, then copy only the runtime artifacts (built dist for server + shared,
# pruned production node_modules, prisma schema + generated client) into a slim
# runtime stage.

# ---------- Builder ----------
FROM node:22-alpine AS builder
WORKDIR /app

# 1) Copy manifests first for better layer caching. npm ci needs the root
#    lockfile + every workspace package.json referenced by "workspaces".
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# 2) Install ALL deps (incl. dev) for the whole workspace.
RUN npm ci

# 3) Copy the rest of the source needed to build shared + server.
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/

# 4) Build the shared package (produces packages/shared/dist) so its
#    "main"/"types" resolve, generate the Prisma client (NO DB needed — this is
#    pure codegen from schema.prisma into node_modules/.prisma), then compile
#    the server (tsc -> packages/server/dist).
#    NOTE: `prisma migrate deploy` is a DEPLOY-time step (needs a live DB) and is
#    intentionally NOT run here — run it as a release/init step against the real
#    database before/at container start.
RUN npm run build:shared
RUN npm run db:generate -w packages/server
RUN npm run build:server

# 5) Prune dev dependencies AFTER codegen so the generated Prisma client (kept by
#    the production dep @prisma/client + node_modules/.prisma) survives, while
#    typescript/prisma-CLI/etc. are dropped from the runtime node_modules.
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# curl is used by the compose `server` healthcheck (GET /api/v1/health).
# node:22-alpine ships without it; install just curl (no recommends) so the
# container can probe its own liveness. Additive — does not affect the app.
RUN apk add --no-cache curl

# Copy the workspace root manifests and the pruned, production node_modules.
# In npm workspaces the hoisted dependencies live in the ROOT node_modules,
# while the workspace packages are symlinked under node_modules/@badminton/*.
# Copying the full root node_modules preserves those symlinks/structure.
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# Built workspace packages (their package.json + compiled dist).
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# Prisma schema + migrations (needed for `prisma migrate deploy` at deploy time;
# the generated client itself lives in node_modules/.prisma & @prisma/client).
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma

# Run as the unprivileged user that the node images ship with.
USER node

# The app reads PORT from the environment (defaults to 3000 in code).
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/packages/server
# The server tsconfig uses rootDir "." and also includes prisma/seed.ts, so tsc
# preserves the src/ folder under dist -> the entry point is dist/src/index.js
# (NOT dist/index.js).
CMD ["node", "dist/src/index.js"]

# ---------- Migrator (one-shot) ----------
# The runtime stage above runs `npm prune --omit=dev`, which strips the Prisma
# CLI (a devDependency) and ts-node — so migrations/seed CANNOT run from it.
# This stage reuses the FULL builder (Prisma CLI + ts-node + generated client +
# compiled code all present) purely to run deploy-time DB steps:
#   docker compose run --rm migrate            -> prisma migrate deploy
#   docker compose run --rm migrate npm run db:seed
# It needs a live DATABASE_URL at run time (provided via env_file), never at build.
# compose targets this explicitly (target: migrator); the server targets `runner`.
FROM builder AS migrator
WORKDIR /app/packages/server
CMD ["npx", "prisma", "migrate", "deploy"]
