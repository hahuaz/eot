import { defineConfig } from "vitest/config";
import path from "path";
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      reporter: ["text", "lcov"],
    },
    env: {
      NODE_ENV: "development",
    },
  },
  resolve: {
    // should be same as tsconfig.json
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
