FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run api:build
# Self-contained production dependency tree for the api only, so the runtime
# image does not carry the workspace's build toolchain.
# --legacy: the workspace does not use injected dependencies, and the app bundle
# already contains the workspace libraries, so only third-party deps are needed.
RUN pnpm --filter @bitex/api deploy --prod --legacy /deploy

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATABASE_MIGRATIONS_DIR=/app/sql/migrations \
    DATABASE_SEED_PATH=/app/sql/seed.sql
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /workspace/apps/api/dist ./dist
# Migrations are applied by the application at startup, so they ship with it.
COPY --from=build /workspace/apps/api/src/infrastructure/database ./sql
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
