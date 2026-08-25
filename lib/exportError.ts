import { NextResponse } from "next/server";

/**
 * An export route's failure, as something a person can read.
 *
 * These routes are reached by a plain GET form, so the BROWSER navigates to them
 * — and they answered with `{"error":"unauthorised"}` on a white page: no
 * header, no Dutch, no link, no login prompt. A coordinator whose session had
 * lapsed had the back button and no way to know that signing in again was the
 * answer. One route returned the raw Postgres error message.
 *
 * Sends her back where she came from with a code the page already knows how to
 * render, rather than inventing an error screen. lib/authErrors.ts is that
 * vocabulary, and every one of these destinations renders it.
 */
export function exportFailed(origin: string, backTo: string, code: string): NextResponse {
  return NextResponse.redirect(new URL(`${backTo}?error=${code}`, origin));
}
