import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Invoices are built with pdfkit, which reads its built-in AFM font metrics
   * off disk at runtime. Turbopack would otherwise try to bundle that package
   * for the server build and lose the data files, so pdfkit has to stay an
   * external require. Symptom when this is missing: invoice generation throws
   * ENOENT on Helvetica.afm only in a built app, never in dev.
   */
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
