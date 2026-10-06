# routing-service SafeWay — image de production (build depuis la racine du dépôt)
#   docker build -f infrastructure/docker/routing.Dockerfile -t safeway-routing .

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
COPY apps/routing-service apps/routing-service
RUN npm run build -w @safeway/routing-service

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/realtime-gateway/package.json apps/realtime-gateway/
COPY apps/routing-service/package.json apps/routing-service/
RUN npm ci --omit=dev --ignore-scripts -w @safeway/routing-service

FROM node:22-alpine
ENV NODE_ENV=production ROUTING_HOST=0.0.0.0 ROUTING_PORT=3002
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/routing-service/dist ./apps/routing-service/dist
COPY --from=build /app/apps/routing-service/package.json ./apps/routing-service/
WORKDIR /app/apps/routing-service
USER node
EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:3002/health || exit 1
CMD ["node", "dist/index.js"]
