import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/*
 * Vitest does not read the `paths` mapping out of tsconfig.json, so without this
 * the alias resolves in the Next build and fails under test. It isn't enough to
 * write tests with relative imports either: lib/fees.ts imports "@/lib/money"
 * itself, so the alias has to work for the module graph under test, not just for
 * the test file at the top of it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    // Every suite here is pure logic — money, dates, ratings. No DOM needed, and
    // node is markedly faster to boot.
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
