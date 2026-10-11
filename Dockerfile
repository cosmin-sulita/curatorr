# syntax=docker/dockerfile:1
ARG NODE_VERSION=26

# ---- build ------------------------------------------------------------------
# Runs on the build machine's own platform: everything it produces is plain
# JavaScript, so a multi-arch build doesn't need to emulate this stage.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# Runtime dependencies of the server only (pure JS, no native modules).
RUN mkdir /prod && cp package.json package-lock.json /prod/ \
  && mkdir -p /prod/shared /prod/server /prod/web \
  && cp shared/package.json /prod/shared/ && cp server/package.json /prod/server/ && cp web/package.json /prod/web/ \
  && cd /prod && npm ci --omit=dev --workspace=server --ignore-scripts

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine
RUN apk add --no-cache su-exec tzdata

ENV NODE_ENV=production \
    PORT=7979 \
    CONFIG_DIR=/config \
    PUID=1000 \
    PGID=1000

WORKDIR /app
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /config

VOLUME /config
EXPOSE 7979
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
