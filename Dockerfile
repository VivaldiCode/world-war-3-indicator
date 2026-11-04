## Multi-stage Dockerfile for ww3-indicator.
## Build & push (to your registry):  WW3_REGISTRY=registry.example.com bin/deploy.sh
##
## Optional build args, to install only from local mirrors (see bin/deploy.sh):
##   BASE_IMAGE    the Node base image
##   APT_MIRROR    base URL with `debian/` and `debian-security/` below it
##   NPM_REGISTRY  npm registry; better-sqlite3 then compiles from source, since
##                 its prebuilt binary would come from github.com

ARG BASE_IMAGE=node:22-bookworm-slim

# ---------- base ----------
FROM ${BASE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ARG APT_MIRROR=
# The base image may have no CA bundle, and apt needs one to reach an HTTPS
# mirror. Node ships Mozilla's roots, so start from those.
RUN if [ -n "$APT_MIRROR" ]; then \
      sed -i -e "s#http://deb.debian.org/debian-security#${APT_MIRROR%/}/debian-security#" \
             -e "s#http://deb.debian.org/debian#${APT_MIRROR%/}/debian#" \
             /etc/apt/sources.list.d/debian.sources; \
      if [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then \
        mkdir -p /etc/ssl/certs \
        && node -p "require('tls').rootCertificates.join('\\n')" > /etc/ssl/certs/ca-certificates.crt; \
      fi; \
    fi

# ---------- deps ----------
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential libsqlite3-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ARG NPM_REGISTRY=
COPY package.json package-lock.json* ./
RUN if [ -n "$NPM_REGISTRY" ]; then \
      npm config set registry "$NPM_REGISTRY"; \
      export npm_config_build_from_source=true npm_config_nodedir=/usr/local; \
    fi; \
    if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

# ---------- builder ----------
FROM deps AS build
COPY tsconfig.json next.config.mjs postcss.config.mjs tailwind.config.ts next-env.d.ts ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm run build

# Prune to production-only deps for the runner stage.
RUN npm prune --omit=dev

# ---------- runner ----------
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server binds to $HOSTNAME, which Docker sets to the container
# id: without this the healthcheck on 127.0.0.1 is refused while the app is fine.
ENV HOSTNAME=0.0.0.0
ENV WW3_DATA_DIR=/data
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libsqlite3-0 dumb-init \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -m -u 1001 ww3 \
    && mkdir -p /data && chown -R ww3:ww3 /data

# Next.js standalone output + static assets + public dir
COPY --from=build --chown=ww3:ww3 /app/.next/standalone ./
COPY --from=build --chown=ww3:ww3 /app/.next/static ./.next/static
COPY --from=build --chown=ww3:ww3 /app/public ./public

# Native dep + pg client need their compiled bits in /node_modules
COPY --from=build --chown=ww3:ww3 /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build --chown=ww3:ww3 /app/node_modules/pg ./node_modules/pg
COPY --from=build --chown=ww3:ww3 /app/node_modules/pg-* ./node_modules/

USER ww3
EXPOSE 3000
VOLUME ["/data"]

# Optional: simple healthcheck for orchestrators that monitor liveness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
