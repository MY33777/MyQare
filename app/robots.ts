import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Keeps crawlers on the public pages and out of the app.
 *
 * The disallow list is not about tidiness. A crawled shift page would tell a
 * search engine which named freelancer works which nights at which address, and
 * an indexed invoice URL is a personal-data leak with a permanent cache. The
 * pages behind these paths all require a session, but robots.txt costs nothing
 * and removes the class of accident where one route is accidentally made public.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/professional/",
          "/zorginstelling/",
          "/beheer/",
          "/api/",
          "/onboarding",
          "/geen-toegang",
          "/wachtwoord-herstellen",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
