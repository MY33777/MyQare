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
    /*
     * Forked processes, not worker threads.
     *
     * supabase/sql.test.ts loads PostgreSQL's own grammar compiled to WASM
     * (pg-query-emscripten). Under worker_threads its function table comes back
     * mangled — every call fails with "Ma[...] is not a function" — which reads
     * exactly like a parse failure and would have made the whole SQL suite
     * vacuously red. Forks cost a few hundred milliseconds on a suite this size.
     */
    pool: "forks",
  },
});
