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
  },
  resolve: {
    // should be same as tsconfig.json
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
