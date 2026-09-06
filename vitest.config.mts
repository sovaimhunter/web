import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/{unit,api,stability}/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    reporters: ["default", "junit", "json"],
    outputFile: {
      junit: "test-results/vitest-junit.xml",
      json: "test-results/vitest-results.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
    },
  },
});
