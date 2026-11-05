# Contributing

Small, focused fixes and reproducible reports are welcome. Discuss larger changes in an issue before spending significant time on them.

## Local checks

Use Node.js 24, OpenSSL and Chromium through Playwright:

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run check:public
```

On Linux CI, use `npx playwright install --with-deps chromium`. On Windows, the TLS tests detect the usual Git for Windows OpenSSL executable; install OpenSSL or adjust the executable selection if your installation differs.

The `electron/` directory contains shared AMT protocol and storage modules retained from the original desktop implementation. The public entry point is `server/server.cjs`; native desktop packaging is not part of this distribution.

UI labels currently use German. Keep wording understandable and update both READMEs or FAQ pages when changing documented behavior. Regenerate synthetic screenshots with `npm run docs:screenshots` when relevant; never take documentation screenshots against personal or customer hardware.

## Pull requests

Explain the problem, resulting behavior and checks performed. Include firmware details for protocol fixes, but remove real network identifiers and credentials. Add tests for meaningful protocol/permission changes, use isolated fixtures, and do not send power/reset commands to real hardware from automated tests.

Do not commit runtime data, TLS private keys, local `.env` files, dependency directories or generated releases. Contributions are submitted under the project's Apache-2.0 license. Preserve third-party attribution when adapting external code.
