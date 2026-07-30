import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/*
 * Next 16 renamed `middleware` to `proxy`. The file must be named proxy.ts and
 * the export must be `proxy` — the old names are deprecated and the edge runtime
 * is not supported here at all (proxy is always nodejs).
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
