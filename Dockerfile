FROM node:22.14.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.14.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3027
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
COPY --from=builder --chown=nextjs:nodejs /app/config ./config
RUN mkdir -p /app/artifacts /app/runtime/worker-status && chown -R nextjs:nodejs /app/data /app/artifacts /app/runtime
USER nextjs
EXPOSE 3027
CMD ["node", "server.js"]

FROM node:22.14.0-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs worker
COPY --from=dependencies --chown=worker:nodejs /app/node_modules ./node_modules
COPY --chown=worker:nodejs package.json ./package.json
COPY --chown=worker:nodejs workers ./workers
COPY --chown=worker:nodejs scripts ./scripts
COPY --chown=worker:nodejs src ./src
COPY --chown=worker:nodejs database ./database
COPY --chown=worker:nodejs data ./data
COPY --chown=worker:nodejs config ./config
RUN mkdir -p /app/artifacts /app/runtime/worker-status && chown -R worker:nodejs /app/data /app/artifacts /app/runtime
USER worker
CMD ["node", "workers/production-supervisor.mjs"]
