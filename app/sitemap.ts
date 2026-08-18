import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Only the pages a stranger should be able to find.
 *
 * Listed by hand rather than walked from the filesystem: a generated sitemap
 * would happily publish every route the moment one is added, and the cost of
 * forgetting to exclude one here is a private URL in a search index.
 */
const PAGES: { path: string; priority: number; changeFrequency: "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "monthly" },
  { path: "/hoe-het-werkt", priority: 0.9, changeFrequency: "monthly" },
  { path: "/voor-zorginstellingen", priority: 0.9, changeFrequency: "monthly" },
  { path: "/voor-zorgprofessionals", priority: 0.9, changeFrequency: "monthly" },
  { path: "/tarieven", priority: 0.8, changeFrequency: "monthly" },
  { path: "/veelgestelde-vragen", priority: 0.7, changeFrequency: "monthly" },
  { path: "/over-ons", priority: 0.6, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/modelovereenkomst", priority: 0.5, changeFrequency: "monthly" },
  { path: "/privacy", priority: 0.4, changeFrequency: "yearly" },
  { path: "/voorwaarden", priority: 0.4, changeFrequency: "yearly" },
  { path: "/registreren", priority: 0.5, changeFrequency: "yearly" },
  { path: "/login", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((page) => ({
    url: `${SITE_URL}${page.path}`,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
