import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      // The real `obsidian` runtime only exists inside the Electron app; route
      // imports to a lightweight mock so main.ts can be unit-tested under jsdom.
      obsidian: fileURLToPath(new URL("./test/mocks/obsidian.ts", import.meta.url)),
    },
  },
});
