/*
 * Where somebody is willing to work, as a fixed list rather than a text box.
 *
 * WHY THIS EXISTS
 * ---------------
 * Region was free text on both sides and matched with
 * `shift.includes(freelancer) || freelancer.includes(shift)`. That is not a
 * near-miss, it is a different feature:
 *
 *   - "a" as a region matches almost every place name in the Netherlands, so one
 *     freelancer typing a single character received every region-wide shift
 *     posted anywhere. Each of those is a shift_offers row, and a shift_offers
 *     row is what grants that facility standing read access to her BIG number,
 *     her rate and her profile.
 *   - "Holland" matched both Noord-Holland and Zuid-Holland — the entire west.
 *   - "Den Haag" and "'s-Gravenhage" are the same city and matched nothing.
 *   - "Ede" and "Edam" are 150km apart and one contains the other.
 *
 * A list also fixes the thing a text box could never do: a facility in Schiedam
 * and a nurse who wrote "Rotterdam" are ten minutes apart and never matched,
 * because neither string contains the other.
 *
 * WHY COROP AND NOT PROVINCES OR GEMEENTEN
 * ----------------------------------------
 * Provinces are too coarse — Noord-Holland stretches from Amsterdam to Den
 * Helder, which is not one labour market. Gemeenten are too fine: 342 options in
 * a select, and a nurse in Schiedam would have to tick a dozen to describe
 * "Rotterdam and around".
 *
 * COROP regions are the CBS's own division of the country into commuting areas —
 * built by asking where people actually travel to work, which is exactly the
 * question this field is for. Forty of them, each recognisable by its main
 * towns.
 *
 * `places` is not decoration. It labels the option so somebody recognises their
 * own town, and it is what maps the free text already in the database onto a
 * code (see matchLegacyRegion).
 */

export type Region = {
  /** Stable key. Stored in the database; never shown. */
  code: string;
  label: string;
  province: string;
  /** Main towns, for the option label and for mapping old free text. */
  places: string[];
};

export const REGIONS: Region[] = [
  // ---------------------------------------------------------------- Groningen
  { code: "oost-groningen", label: "Oost-Groningen", province: "Groningen", places: ["Veendam", "Stadskanaal", "Winschoten", "Oldambt", "Pekela", "Westerwolde"] },
  { code: "delfzijl", label: "Delfzijl en omgeving", province: "Groningen", places: ["Delfzijl", "Appingedam", "Loppersum", "Eemsdelta"] },
  { code: "overig-groningen", label: "Groningen en omgeving", province: "Groningen", places: ["Groningen", "Haren", "Zuidhorn", "Leek", "Hoogezand", "Westerkwartier"] },

  // ---------------------------------------------------------------- Friesland
  { code: "noord-friesland", label: "Noord-Friesland", province: "Friesland", places: ["Leeuwarden", "Franeker", "Harlingen", "Dokkum", "Ameland", "Terschelling"] },
  { code: "zuidwest-friesland", label: "Zuidwest-Friesland", province: "Friesland", places: ["Sneek", "Bolsward", "Joure", "Lemmer", "Súdwest-Fryslân"] },
  { code: "zuidoost-friesland", label: "Zuidoost-Friesland", province: "Friesland", places: ["Drachten", "Heerenveen", "Wolvega", "Gorredijk", "Smallingerland"] },

  // ------------------------------------------------------------------ Drenthe
  { code: "noord-drenthe", label: "Noord-Drenthe", province: "Drenthe", places: ["Assen", "Roden", "Gieten", "Beilen", "Tynaarlo"] },
  { code: "zuidoost-drenthe", label: "Zuidoost-Drenthe", province: "Drenthe", places: ["Emmen", "Coevorden", "Klazienaveen", "Borger-Odoorn"] },
  { code: "zuidwest-drenthe", label: "Zuidwest-Drenthe", province: "Drenthe", places: ["Meppel", "Hoogeveen", "Westerveld", "De Wolden"] },

  // --------------------------------------------------------------- Overijssel
  { code: "noord-overijssel", label: "Noord-Overijssel", province: "Overijssel", places: ["Zwolle", "Kampen", "Steenwijk", "Hardenberg", "Dalfsen"] },
  { code: "zuidwest-overijssel", label: "Zuidwest-Overijssel", province: "Overijssel", places: ["Deventer", "Raalte", "Olst", "Wijhe"] },
  { code: "twente", label: "Twente", province: "Overijssel", places: ["Enschede", "Hengelo", "Almelo", "Oldenzaal", "Borne", "Rijssen"] },

  // ---------------------------------------------------------------- Flevoland
  { code: "flevoland", label: "Flevoland", province: "Flevoland", places: ["Almere", "Lelystad", "Emmeloord", "Dronten", "Urk", "Zeewolde", "Noordoostpolder"] },

  // --------------------------------------------------------------- Gelderland
  { code: "veluwe", label: "Veluwe", province: "Gelderland", places: ["Apeldoorn", "Amersfoort-oost", "Ede", "Harderwijk", "Barneveld", "Wageningen", "Nunspeet"] },
  { code: "achterhoek", label: "Achterhoek", province: "Gelderland", places: ["Doetinchem", "Winterswijk", "Zutphen", "Lochem", "Aalten", "Oude IJsselstreek"] },
  { code: "arnhem-nijmegen", label: "Arnhem en Nijmegen", province: "Gelderland", places: ["Arnhem", "Nijmegen", "Wijchen", "Elst", "Zevenaar", "Beuningen", "Renkum"] },
  { code: "zuidwest-gelderland", label: "Rivierenland", province: "Gelderland", places: ["Tiel", "Culemborg", "Geldermalsen", "Zaltbommel", "West Betuwe"] },

  // ------------------------------------------------------------------ Utrecht
  { code: "utrecht", label: "Utrecht en omgeving", province: "Utrecht", places: ["Utrecht", "Amersfoort", "Nieuwegein", "Zeist", "Veenendaal", "Woerden", "Houten", "Soest"] },

  // ----------------------------------------------------------- Noord-Holland
  { code: "kop-noord-holland", label: "Kop van Noord-Holland", province: "Noord-Holland", places: ["Den Helder", "Schagen", "Texel", "Hollands Kroon", "Medemblik"] },
  { code: "alkmaar", label: "Alkmaar en omgeving", province: "Noord-Holland", places: ["Alkmaar", "Heerhugowaard", "Langedijk", "Bergen", "Castricum", "Heiloo"] },
  { code: "ijmond", label: "IJmond", province: "Noord-Holland", places: ["Beverwijk", "Velsen", "IJmuiden", "Heemskerk"] },
  { code: "haarlem", label: "Haarlem en omgeving", province: "Noord-Holland", places: ["Haarlem", "Heemstede", "Bloemendaal", "Zandvoort"] },
  { code: "zaanstreek", label: "Zaanstreek", province: "Noord-Holland", places: ["Zaandam", "Zaanstad", "Wormerland", "Purmerend"] },
  { code: "groot-amsterdam", label: "Groot-Amsterdam", province: "Noord-Holland", places: ["Amsterdam", "Amstelveen", "Hoofddorp", "Haarlemmermeer", "Diemen", "Ouder-Amstel", "Aalsmeer", "Uithoorn", "Edam", "Volendam"] },
  { code: "gooi-vechtstreek", label: "Het Gooi en Vechtstreek", province: "Noord-Holland", places: ["Hilversum", "Bussum", "Huizen", "Laren", "Weesp", "Gooise Meren"] },

  // ------------------------------------------------------------- Zuid-Holland
  { code: "leiden-bollenstreek", label: "Leiden en Bollenstreek", province: "Zuid-Holland", places: ["Leiden", "Katwijk", "Noordwijk", "Lisse", "Alphen aan den Rijn", "Leiderdorp", "Oegstgeest"] },
  { code: "den-haag", label: "Den Haag en omgeving", province: "Zuid-Holland", places: ["Den Haag", "'s-Gravenhage", "Zoetermeer", "Rijswijk", "Leidschendam", "Voorburg", "Wassenaar", "Scheveningen"] },
  { code: "delft-westland", label: "Delft en Westland", province: "Zuid-Holland", places: ["Delft", "Naaldwijk", "Westland", "Pijnacker", "Nootdorp", "Midden-Delfland"] },
  { code: "oost-zuid-holland", label: "Oost-Zuid-Holland", province: "Zuid-Holland", places: ["Gouda", "Waddinxveen", "Bodegraven", "Zuidplas", "Krimpenerwaard"] },
  { code: "groot-rijnmond", label: "Groot-Rijnmond", province: "Zuid-Holland", places: ["Rotterdam", "Schiedam", "Vlaardingen", "Capelle aan den IJssel", "Spijkenisse", "Barendrecht", "Ridderkerk", "Hellevoetsluis", "Brielle"] },
  { code: "zuidoost-zuid-holland", label: "Drechtsteden", province: "Zuid-Holland", places: ["Dordrecht", "Zwijndrecht", "Papendrecht", "Sliedrecht", "Gorinchem", "Hendrik-Ido-Ambacht"] },

  // ------------------------------------------------------------------ Zeeland
  { code: "zeeuws-vlaanderen", label: "Zeeuws-Vlaanderen", province: "Zeeland", places: ["Terneuzen", "Hulst", "Sluis", "Oostburg"] },
  { code: "overig-zeeland", label: "Zeeland (overig)", province: "Zeeland", places: ["Middelburg", "Vlissingen", "Goes", "Zierikzee", "Tholen", "Schouwen-Duiveland"] },

  // ------------------------------------------------------------ Noord-Brabant
  { code: "west-brabant", label: "West-Brabant", province: "Noord-Brabant", places: ["Breda", "Roosendaal", "Bergen op Zoom", "Oosterhout", "Etten-Leur", "Moerdijk"] },
  { code: "midden-brabant", label: "Midden-Brabant", province: "Noord-Brabant", places: ["Tilburg", "Waalwijk", "Oisterwijk", "Goirle", "Dongen"] },
  { code: "noordoost-brabant", label: "Noordoost-Brabant", province: "Noord-Brabant", places: ["'s-Hertogenbosch", "Den Bosch", "Oss", "Uden", "Veghel", "Boxtel", "Meierijstad"] },
  { code: "zuidoost-brabant", label: "Zuidoost-Brabant", province: "Noord-Brabant", places: ["Eindhoven", "Helmond", "Veldhoven", "Geldrop", "Best", "Nuenen", "Valkenswaard"] },

  // ------------------------------------------------------------------ Limburg
  { code: "noord-limburg", label: "Noord-Limburg", province: "Limburg", places: ["Venlo", "Venray", "Horst", "Peel en Maas", "Gennep"] },
  { code: "midden-limburg", label: "Midden-Limburg", province: "Limburg", places: ["Roermond", "Weert", "Echt", "Susteren", "Leudal"] },
  { code: "zuid-limburg", label: "Zuid-Limburg", province: "Limburg", places: ["Maastricht", "Heerlen", "Sittard", "Geleen", "Kerkrade", "Valkenburg", "Landgraaf"] },
];

/** Lookup by code. Returns null for anything not on the list. */
export function findRegion(code: string | null | undefined): Region | null {
  if (!code) return null;
  return REGIONS.find((region) => region.code === code) ?? null;
}

/** The label to show, or the raw value for legacy free text we cannot place. */
export function regionLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return findRegion(code)?.label ?? code;
}

/** Grouped for an <optgroup>, so forty options stay findable. */
export function regionsByProvince(): { province: string; regions: Region[] }[] {
  const groups = new Map<string, Region[]>();
  for (const region of REGIONS) {
    if (!groups.has(region.province)) groups.set(region.province, []);
    groups.get(region.province)!.push(region);
  }
  return [...groups.entries()].map(([province, regions]) => ({ province, regions }));
}

/**
 * Does a shift's region reach this freelancer?
 *
 * Exact codes, both sides. The old version compared free text with
 * `includes()` in both directions, which made a one-character region a wildcard
 * over the whole country — and every match is a shift_offers row granting that
 * facility a standing read of the freelancer's profile.
 *
 * A freelancer may hold several regions, because somebody in Schiedam works in
 * both Groot-Rijnmond and Delft en Westland and picking one would be wrong
 * either way.
 *
 * A blank on either side is still not a wildcard, for the reason in the long
 * note that used to live in lib/availability.ts: region is consulted only for
 * the visibility that reaches strangers.
 */
export function regionMatches(
  shiftRegionCode: string | null | undefined,
  freelancerRegionCodes: string[] | null | undefined,
): boolean {
  if (!shiftRegionCode) return false;
  const mine = freelancerRegionCodes ?? [];
  if (mine.length === 0) return false;
  return mine.includes(shiftRegionCode);
}

/**
 * Best-effort mapping of the free text already in the database onto a code.
 *
 * Used once by migration 022's backfill and by the profile form, which shows
 * somebody their old answer pre-selected rather than blank. Deliberately
 * conservative: an exact match on a label, a province, or one of the region's
 * towns. Anything else returns null and the person picks from the list, which
 * is a better outcome than guessing a region on their behalf and quietly
 * changing who can see them.
 */
export function matchLegacyRegion(value: string | null | undefined): string | null {
  const needle = (value ?? "").trim().toLowerCase();
  if (needle.length < 3) return null;

  for (const region of REGIONS) {
    if (region.label.toLowerCase() === needle) return region.code;
    if (region.code === needle) return region.code;
  }

  for (const region of REGIONS) {
    if (region.places.some((place) => place.toLowerCase() === needle)) return region.code;
  }

  // A province name on its own cannot pick between its regions — "Noord-Holland"
  // is seven of them — so it stays unmatched rather than being assigned to one.
  return null;
}
