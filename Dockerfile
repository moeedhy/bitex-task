FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm nx run api:build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/apps/api/dist ./dist
COPY --from=build /workspace/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main.js"]
