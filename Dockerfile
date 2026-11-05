FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY index.html vite.config.mjs ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production AMT_BIND=0.0.0.0 AMT_PORT=9443 AMT_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY electron ./electron
COPY server ./server
COPY --from=frontend /build/dist ./dist
COPY licenses ./licenses
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 9443
CMD ["node", "server/server.cjs"]

# Verify the actual target Node runtime, HTTP API and browser sessions on both CPUs.
FROM runtime AS verify
COPY tests/browser.test.cjs ./tests/browser.test.cjs
COPY tests/snapshot.test.cjs ./tests/snapshot.test.cjs
COPY tests/jetkvm.test.cjs ./tests/jetkvm.test.cjs
COPY tests/jetkvm-tools.test.cjs ./tests/jetkvm-tools.test.cjs
COPY tests/media-compat.test.cjs tests/redirection-extra.test.cjs ./tests/
COPY src/jetkvm-input.mjs src/kvm-keyboard.mjs src/jetkvm-rpc.mjs ./src/
RUN node --test tests/browser.test.cjs tests/snapshot.test.cjs tests/jetkvm.test.cjs tests/jetkvm-tools.test.cjs tests/media-compat.test.cjs tests/redirection-extra.test.cjs \
    && node -e "require('fs').writeFileSync('/tmp/build-verification.json', JSON.stringify({platform:process.platform,architecture:process.arch,node:process.version,browserTestsPassed:2,snapshotTestsPassed:2,jetkvmTestsPassed:4,jetkvmToolsTestsPassed:3,mediaAndRedirectionTestsPassed:10}))"

FROM runtime AS release
COPY --from=verify /tmp/build-verification.json /app/build-verification.json
