import { defineConfig } from "vitest/config";

// Slow install tests pack the tarball and shell out to npm install (~30s
// each). They're excluded from the default `npm test` run, but `npm run
// test:install` sets RUN_INSTALL_TESTS=1 to include them.
const includeInstallTests = process.env.RUN_INSTALL_TESTS === "1";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mjs"],
    exclude: includeInstallTests
      ? ["**/node_modules/**"]
      : ["tests/tarball-install.test.mjs", "**/node_modules/**"],
    environment: "node",
    globals: false,
    pool: "threads",
    testTimeout: includeInstallTests ? 240_000 : 15_000,
    reporters: ["default"],
  },
});
