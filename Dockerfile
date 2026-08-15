# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /src/app
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/ ./
RUN pnpm run build && pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
# The production entrypoint invokes Node directly. Remove the package managers
# inherited from the base image so their unused dependency trees are not part
# of the runtime image or its vulnerability surface.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 git ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 claudex \
    && useradd --uid 10001 --gid claudex --create-home --shell /usr/sbin/nologin claudex
ARG CLAUDEX_WORKHOUSE_COMMIT_SHA=unknown
ARG CLAUDEX_WORKHOUSE_RELEASE_VERSION=unknown
LABEL org.opencontainers.image.version="${CLAUDEX_WORKHOUSE_RELEASE_VERSION}"
ENV NODE_ENV=production CLAUDEX_WORKHOUSE_ROOT=/opt/claudex-workhouse CLAUDEX_WORKHOUSE_HOST=0.0.0.0 HOME=/opt/claudex-workhouse/runtime/home CLAUDEX_WORKHOUSE_DISTRIBUTION_STATUS=Official CLAUDEX_WORKHOUSE_COMMIT_SHA=${CLAUDEX_WORKHOUSE_COMMIT_SHA} CLAUDEX_WORKHOUSE_VERSION=${CLAUDEX_WORKHOUSE_RELEASE_VERSION}
WORKDIR /opt/claudex-workhouse
COPY --from=build --chown=claudex:claudex /src/app/package.json /opt/claudex-workhouse/app/package.json
COPY --from=build --chown=claudex:claudex /src/app/node_modules /opt/claudex-workhouse/app/node_modules
COPY --from=build --chown=claudex:claudex /src/app/bin /opt/claudex-workhouse/app/bin
COPY --from=build --chown=claudex:claudex /src/app/dist /opt/claudex-workhouse/app/dist
COPY --from=build --chown=claudex:claudex /src/app/dist-server /opt/claudex-workhouse/app/dist-server
# The Python DB worker and emotion assets are runtime inputs rather than
# TypeScript build outputs. Copy only those source assets instead of shipping
# the complete development tree, tests, and dev dependencies.
COPY --from=build --chown=claudex:claudex /src/app/src/server/db/sqlite-worker.py /opt/claudex-workhouse/app/src/server/db/sqlite-worker.py
COPY --from=build --chown=claudex:claudex /src/app/public/emoticons /opt/claudex-workhouse/app/public/emoticons
COPY --chown=claudex:claudex bin/container-init.mjs bin/claude-runtime.mjs bin/codex-runtime.mjs bin/claude-auth-pty.py /opt/claudex-workhouse/bin/
COPY --chown=claudex:claudex deploy /opt/claudex-workhouse/deploy
COPY --chown=claudex:claudex LICENSE LICENSE.ko.md LICENSE.ja.md NOTICE.md NOTICE.ko.md NOTICE.ja.md THIRD_PARTY_NOTICES.md THIRD_PARTY_NOTICES.ko.md THIRD_PARTY_NOTICES.ja.md /opt/claudex-workhouse/licenses/
RUN mkdir -p config data logs run runtime/bin runtime/home snapshots workspaces && chown -R claudex:claudex /opt/claudex-workhouse
USER claudex
EXPOSE 3410
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:3410/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sh","-c","umask 077 && node bin/container-init.mjs && node app/dist-server/index.js"]
