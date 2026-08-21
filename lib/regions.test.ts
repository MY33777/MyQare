import { describe, expect, it } from "vitest";
import {
  REGIONS,
  findRegion,
  matchLegacyRegion,
  regionLabel,
  regionMatches,
  regionsByProvince,
} from "@/lib/regions";

/*
 * Region decides who receives a shift offered to strangers, and every offer
 * written is a shift_offers row granting that facility a standing read of the
 * freelancer's BIG number and rate. So the failure that matters is over-matching,
 * and it is the one the old free-text version had in abundance.
 */

describe("the list itself", () => {
  it("has the forty COROP regions", () => {
    expect(REGIONS).toHaveLength(40);
  });

  it("has no duplicate codes", () => {
    const codes = REGIONS.map((region) => region.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("gives every region at least three recognisable towns", () => {
    // The label alone is not enough: "Groot-Rijnmond" means nothing to somebody
    // in Schiedam, and the towns are what makes the option findable.
    for (const region of REGIONS) {
      expect(region.places.length, region.code).toBeGreaterThanOrEqual(3);
    }
  });

  it("groups into the twelve provinces", () => {
    expect(regionsByProvince()).toHaveLength(12);
  });
});

describe("regionMatches", () => {
  it("matches a shift to a freelancer who chose that region", () => {
    expect(regionMatches("groot-rijnmond", ["groot-rijnmond"])).toBe(true);
  });

  it("matches when the freelancer holds several", () => {
    // Somebody in Schiedam works in both, which is why this is an array.
    expect(regionMatches("delft-westland", ["groot-rijnmond", "delft-westland"])).toBe(true);
  });

  it("does not match a different region", () => {
    expect(regionMatches("groot-rijnmond", ["twente"])).toBe(false);
  });

  /*
   * The whole reason this module exists. The old implementation compared free
   * text with includes() in both directions.
   */
  it("is not a substring match", () => {
    // "a" used to match almost every place name in the country, and each match
    // wrote a shift_offers row exposing the freelancer's profile to that facility.
    expect(regionMatches("groot-rijnmond", ["a"])).toBe(false);
    expect(regionMatches("noord-limburg", ["limburg"])).toBe(false);
    expect(regionMatches("zuid-limburg", ["noord-limburg"])).toBe(false);
  });

  it("treats a blank on either side as no match, not as everyone", () => {
    /*
     * A missing region is not a wildcard. It used to be, and a facility whose
     * city was unset — the field is optional at onboarding — broadcast every
     * shift to every freelancer on the platform.
     */
    expect(regionMatches(null, ["groot-rijnmond"])).toBe(false);
    expect(regionMatches("groot-rijnmond", [])).toBe(false);
    expect(regionMatches("groot-rijnmond", null)).toBe(false);
    expect(regionMatches("", [""])).toBe(false);
  });
});

describe("matchLegacyRegion", () => {
  it("maps a town onto its region", () => {
    // The case the old matcher got wrong in the other direction: Schiedam and
    // Rotterdam are ten minutes apart and neither string contains the other.
    expect(matchLegacyRegion("Schiedam")).toBe("groot-rijnmond");
    expect(matchLegacyRegion("Rotterdam")).toBe("groot-rijnmond");
  });

  it("maps both names for the same city", () => {
    expect(matchLegacyRegion("Den Haag")).toBe("den-haag");
    expect(matchLegacyRegion("'s-Gravenhage")).toBe("den-haag");
  });

  it("matches a region label", () => {
    expect(matchLegacyRegion("Twente")).toBe("twente");
  });

  it("ignores case and surrounding space", () => {
    expect(matchLegacyRegion("  EINDHOVEN  ")).toBe("zuidoost-brabant");
  });

  it("refuses a province, because it cannot pick between its regions", () => {
    // Noord-Holland is seven regions. Guessing one changes who can see somebody.
    expect(matchLegacyRegion("Noord-Holland")).toBeNull();
    expect(matchLegacyRegion("Zuid-Holland")).toBeNull();
  });

  it("refuses anything short enough to be ambiguous", () => {
    expect(matchLegacyRegion("a")).toBeNull();
    expect(matchLegacyRegion("ab")).toBeNull();
  });

  it("returns null for free text it cannot place", () => {
    // "omgeving Utrecht, liefst niet 's nachts" is a real answer somebody gave a
    // text box. Better unmatched than assigned to a region they did not pick.
    expect(matchLegacyRegion("omgeving Utrecht, liefst niet 's nachts")).toBeNull();
    expect(matchLegacyRegion("")).toBeNull();
    expect(matchLegacyRegion(null)).toBeNull();
  });
});

describe("findRegion and regionLabel", () => {
  it("finds a region by code", () => {
    expect(findRegion("twente")?.label).toBe("Twente");
  });

  it("returns null for an unknown code rather than throwing", () => {
    expect(findRegion("atlantis")).toBeNull();
  });

  it("falls back to the raw value so legacy free text still renders", () => {
    // A row that predates the list shows what the person actually typed rather
    // than an em dash that erases their answer.
    expect(regionLabel("omgeving Utrecht")).toBe("omgeving Utrecht");
    expect(regionLabel("twente")).toBe("Twente");
    expect(regionLabel(null)).toBe("—");
  });
});
