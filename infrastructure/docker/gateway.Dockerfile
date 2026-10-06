# Realtime gateway SafeWay — image de production (build depuis la racine du dépôt)
#   docker build -f infrastructure/docker/gateway.Dockerfile -t safeway-gateway .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/realtime-gateway/package.json apps/realtime-gateway/
COPY apps/routing-service/package.json apps/routing-service/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/realtime-gateway apps/realtime-gateway
RUN npm run build -w @safeway/realtime-gateway

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/realtime-gateway/package.json apps/realtime-gateway/
COPY apps/routing-service/package.json apps/routing-service/
RUN npm ci --omit=dev --ignore-scripts -w @safeway/realtime-gateway

FROM node:22-alpine
ENV NODE_ENV=production GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=3001
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/realtime-gateway/dist ./apps/realtime-gateway/dist
COPY --from=build /app/apps/realtime-gateway/package.json ./apps/realtime-gateway/
WORKDIR /app/apps/realtime-gateway
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "dist/index.js"]
