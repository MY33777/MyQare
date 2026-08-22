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
       * 4MB here against a 4MB check in lib/documents.ts — see MAX_DOCUMENT_BYTES.
       *
       * This said 6MB, reasoning that the gap above the app's own 5MB limit meant
       * a file at exactly that limit would still reach our error message rather
       * than the framework's. On Vercel that reasoning does not survive contact
       * with the platform: Functions reject any request body over 4.5MB at the
       * edge, before the function is invoked. So the entire 4.5–5MB band was
       * advertised by the upload form, accepted by lib/documents.ts, and
       * unreachable — a raw 413 the app never saw and could not explain.
       *
       * Both numbers come down to 4MB, which leaves room under 4.5MB for the
       * multipart boundaries and part headers this limit also counts. A phone
       * photo of a diploma is 2–4MB, so the ceiling that matters is unchanged in
       * practice and is now one the platform will actually deliver.
       */
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
