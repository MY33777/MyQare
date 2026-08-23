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
       * Both numbers came down, and then to exactly the same number — 4MB here
       * and 4MB in MAX_DOCUMENT_BYTES — which made the app's own check dead. This
       * limit counts the WHOLE multipart body, so any file big enough to fail
       * `file.size > MAX_DOCUMENT_BYTES` had already produced a body over this
       * one and was rejected by the framework first. The nurse got the generic
       * error page and no explanation, which is the exact outcome the paragraph
       * above says was fixed, one megabyte lower.
       *
       * 4.4MB here against 4MB there. That leaves a real band — a file between
       * 4MB and about 4.4MB reaches the action and gets a sentence naming the
       * limit — while staying under Vercel's 4.5MB edge rejection, which nothing
       * in the application can catch.
       */
      bodySizeLimit: "4.4mb",
    },
  },
};

export default nextConfig;
