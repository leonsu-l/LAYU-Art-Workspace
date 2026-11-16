# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/contracts/package.json ./apps/api/contracts/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY apps/api/contracts ./apps/api/contracts
COPY apps/web ./apps/web
RUN npm run build:web

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/apps/web/dist /srv
EXPOSE 80
