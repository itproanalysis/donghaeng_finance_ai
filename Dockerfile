FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY migrations ./migrations
COPY contracts ./contracts
COPY next.config.ts tsconfig.json next-env.d.ts ./
ENV DONGHAENG_PUBLIC_DEMO=1
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DONGHAENG_PUBLIC_DEMO=1 PORT=8080
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node scripts/review-server.mjs ./scripts/review-server.mjs
USER node
EXPOSE 8080
CMD ["node", "scripts/review-server.mjs"]
