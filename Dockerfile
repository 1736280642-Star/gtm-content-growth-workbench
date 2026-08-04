FROM node:22.14.0-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:22.14.0-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3027
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
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
COPY --from=builder --chown=worker:nodejs /app/package.json ./package.json
COPY --from=builder --chown=worker:nodejs /app/workers ./workers
COPY --from=builder --chown=worker:nodejs /app/scripts ./scripts
COPY --from=builder --chown=worker:nodejs /app/src ./src
COPY --from=builder --chown=worker:nodejs /app/database ./database
COPY --from=builder --chown=worker:nodejs /app/data ./data
COPY --from=builder --chown=worker:nodejs /app/config ./config
RUN mkdir -p /app/artifacts /app/runtime/worker-status && chown -R worker:nodejs /app/data /app/artifacts /app/runtime
USER worker
CMD ["node", "workers/production-supervisor.mjs"]
