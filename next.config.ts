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

  experimental: {
    serverActions: {
      /*
       * Documents are uploaded through a Server Action, and the default cap is
       * 1MB — which a phone photo of a diploma clears easily, so uploads would
       * fail for the most common case.
       *
       * 6MB here against a 5MB check in lib/documents.ts. The gap is deliberate:
       * this limit applies to the raw HTTP body including multipart boundaries and
       * part headers, so a file at exactly the app's limit would be rejected by the
       * framework before our own error message ever runs.
       */
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
