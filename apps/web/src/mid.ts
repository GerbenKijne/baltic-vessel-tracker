// ITU Maritime Identification Digits (the first 3 digits of an MMSI)
// mapped to their flag state -- lets the vessel drawer show a flag
// without waiting on an AIS static-data message, since the MID is
// already present in every position report. A curated, not exhaustive,
// subset: the Baltic/Nordic region in full (this app's own coverage
// area) plus the flag states most commonly seen in general shipping
// traffic. An MID not listed here falls back to "Unknown" exactly as
// before -- an honest gap, not a guess. iso2 is the ISO 3166-1 alpha-2
// code, used to derive the flag emoji (see flagEmoji below).
const MID_COUNTRY: Record<string, { name: string; iso2: string }> = {
  // Baltic & Nordic
  "230": { name: "Finland", iso2: "FI" },
  "211": { name: "Germany", iso2: "DE" },
  "218": { name: "Germany", iso2: "DE" },
  "219": { name: "Denmark", iso2: "DK" },
  "220": { name: "Denmark", iso2: "DK" },
  "257": { name: "Norway", iso2: "NO" },
  "258": { name: "Norway", iso2: "NO" },
  "259": { name: "Norway", iso2: "NO" },
  "261": { name: "Poland", iso2: "PL" },
  "265": { name: "Sweden", iso2: "SE" },
  "266": { name: "Sweden", iso2: "SE" },
  "273": { name: "Russia", iso2: "RU" },
  "275": { name: "Latvia", iso2: "LV" },
  "276": { name: "Estonia", iso2: "EE" },
  "277": { name: "Lithuania", iso2: "LT" },

  // Rest of Western/Southern Europe
  "205": { name: "Belgium", iso2: "BE" },
  "209": { name: "Cyprus", iso2: "CY" },
  "210": { name: "Cyprus", iso2: "CY" },
  "212": { name: "Cyprus", iso2: "CY" },
  "215": { name: "Malta", iso2: "MT" },
  "224": { name: "Spain", iso2: "ES" },
  "225": { name: "Spain", iso2: "ES" },
  "226": { name: "France", iso2: "FR" },
  "227": { name: "France", iso2: "FR" },
  "228": { name: "France", iso2: "FR" },
  "229": { name: "Malta", iso2: "MT" },
  "232": { name: "United Kingdom", iso2: "GB" },
  "233": { name: "United Kingdom", iso2: "GB" },
  "234": { name: "United Kingdom", iso2: "GB" },
  "235": { name: "United Kingdom", iso2: "GB" },
  "237": { name: "Greece", iso2: "GR" },
  "239": { name: "Greece", iso2: "GR" },
  "240": { name: "Greece", iso2: "GR" },
  "241": { name: "Greece", iso2: "GR" },
  "244": { name: "Netherlands", iso2: "NL" },
  "245": { name: "Netherlands", iso2: "NL" },
  "246": { name: "Netherlands", iso2: "NL" },
  "247": { name: "Italy", iso2: "IT" },
  "248": { name: "Malta", iso2: "MT" },
  "249": { name: "Malta", iso2: "MT" },
  "253": { name: "Luxembourg", iso2: "LU" },
  "255": { name: "Portugal", iso2: "PT" },
  "256": { name: "Malta", iso2: "MT" },
  "263": { name: "Portugal", iso2: "PT" },

  // North America
  "303": { name: "United States", iso2: "US" },
  "316": { name: "Canada", iso2: "CA" },
  "345": { name: "Mexico", iso2: "MX" },
  "366": { name: "United States", iso2: "US" },
  "367": { name: "United States", iso2: "US" },
  "368": { name: "United States", iso2: "US" },
  "369": { name: "United States", iso2: "US" },

  // Asia-Pacific
  "412": { name: "China", iso2: "CN" },
  "413": { name: "China", iso2: "CN" },
  "414": { name: "China", iso2: "CN" },
  "416": { name: "Taiwan", iso2: "TW" },
  "419": { name: "India", iso2: "IN" },
  "431": { name: "Japan", iso2: "JP" },
  "432": { name: "Japan", iso2: "JP" },
  "440": { name: "South Korea", iso2: "KR" },
  "441": { name: "South Korea", iso2: "KR" },
  "477": { name: "Hong Kong", iso2: "HK" },
  "503": { name: "Australia", iso2: "AU" },
  "512": { name: "New Zealand", iso2: "NZ" },
  "563": { name: "Singapore", iso2: "SG" },
  "564": { name: "Singapore", iso2: "SG" },
  "565": { name: "Singapore", iso2: "SG" },
  "566": { name: "Singapore", iso2: "SG" },

  // Open registries commonly seen in general merchant traffic
  "308": { name: "Bahamas", iso2: "BS" },
  "309": { name: "Bahamas", iso2: "BS" },
  "311": { name: "Bahamas", iso2: "BS" },
  "351": { name: "Panama", iso2: "PA" },
  "352": { name: "Panama", iso2: "PA" },
  "353": { name: "Panama", iso2: "PA" },
  "354": { name: "Panama", iso2: "PA" },
  "355": { name: "Panama", iso2: "PA" },
  "356": { name: "Panama", iso2: "PA" },
  "357": { name: "Panama", iso2: "PA" },
  "370": { name: "Panama", iso2: "PA" },
  "371": { name: "Panama", iso2: "PA" },
  "372": { name: "Panama", iso2: "PA" },
  "373": { name: "Panama", iso2: "PA" },
  "374": { name: "Panama", iso2: "PA" },
  "538": { name: "Marshall Islands", iso2: "MH" },
  "636": { name: "Liberia", iso2: "LR" },
  "637": { name: "Liberia", iso2: "LR" },
};

// An ISO 3166-1 alpha-2 code maps onto a flag emoji by encoding each
// letter as its Regional Indicator Symbol codepoint (U+1F1E6 = 'A') --
// no image assets needed, same technique browsers/OSes use internally.
function flagEmoji(iso2: string): string {
  return Array.from(iso2.toUpperCase())
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

export interface CountryInfo {
  name: string;
  flag: string;
}

export function countryForMmsi(mmsi: string): CountryInfo | null {
  const entry = MID_COUNTRY[mmsi.slice(0, 3)];
  return entry ? { name: entry.name, flag: flagEmoji(entry.iso2) } : null;
}
