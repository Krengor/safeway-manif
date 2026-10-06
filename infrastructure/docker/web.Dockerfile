# Front SafeWay + reverse proxy (Caddy : TLS automatique, en-têtes de sécurité, /api → API)
#   docker build -f infrastructure/docker/web.Dockerfile -t safeway-web .
# Les tuiles, polices et sprites ne sont pas dans l'image : monter /srv/map (voir docker-compose.prod.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/realtime-gateway/package.json apps/realtime-gateway/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @safeway/web

FROM caddy:2-alpine
COPY infrastructure/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv/app
