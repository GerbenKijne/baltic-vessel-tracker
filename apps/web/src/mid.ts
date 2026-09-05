// ITU Maritime Identification Digits (the first 3 digits of an MMSI)
// mapped to their flag state -- lets the vessel drawer show a flag
// without waiting on an AIS static-data message, since the MID is
// already present in every position report. A curated, not exhaustive,
// subset: the Baltic/Nordic region in full (this app's own coverage
// area) plus the flag states most commonly seen in general shipping
// traffic. An MID not listed here falls back to "Unknown" exactly as
// before -- an honest gap, not a guess.
const MID_COUNTRY: Record<string, string> = {
  // Baltic & Nordic
  "230": "Finland",
  "211": "Germany",
  "218": "Germany",
  "219": "Denmark",
  "220": "Denmark",
  "257": "Norway",
  "258": "Norway",
  "259": "Norway",
  "261": "Poland",
  "265": "Sweden",
  "266": "Sweden",
  "273": "Russia",
  "275": "Latvia",
  "276": "Estonia",
  "277": "Lithuania",

  // Rest of Western/Southern Europe
  "205": "Belgium",
  "209": "Cyprus",
  "210": "Cyprus",
  "212": "Cyprus",
  "215": "Malta",
  "224": "Spain",
  "225": "Spain",
  "226": "France",
  "227": "France",
  "228": "France",
  "229": "Malta",
  "232": "United Kingdom",
  "233": "United Kingdom",
  "234": "United Kingdom",
  "235": "United Kingdom",
  "237": "Greece",
  "239": "Greece",
  "240": "Greece",
  "241": "Greece",
  "244": "Netherlands",
  "245": "Netherlands",
  "246": "Netherlands",
  "247": "Italy",
  "248": "Malta",
  "249": "Malta",
  "253": "Luxembourg",
  "255": "Portugal",
  "256": "Malta",
  "263": "Portugal",

  // North America
  "303": "United States",
  "316": "Canada",
  "345": "Mexico",
  "366": "United States",
  "367": "United States",
  "368": "United States",
  "369": "United States",

  // Asia-Pacific
  "412": "China",
  "413": "China",
  "414": "China",
  "416": "Taiwan",
  "419": "India",
  "431": "Japan",
  "432": "Japan",
  "440": "South Korea",
  "441": "South Korea",
  "477": "Hong Kong",
  "503": "Australia",
  "512": "New Zealand",
  "563": "Singapore",
  "564": "Singapore",
  "565": "Singapore",
  "566": "Singapore",

  // Open registries commonly seen in general merchant traffic
  "308": "Bahamas",
  "309": "Bahamas",
  "311": "Bahamas",
  "351": "Panama",
  "352": "Panama",
  "353": "Panama",
  "354": "Panama",
  "355": "Panama",
  "356": "Panama",
  "357": "Panama",
  "370": "Panama",
  "371": "Panama",
  "372": "Panama",
  "373": "Panama",
  "374": "Panama",
  "538": "Marshall Islands",
  "636": "Liberia",
  "637": "Liberia",
};

export function countryForMmsi(mmsi: string): string | null {
  return MID_COUNTRY[mmsi.slice(0, 3)] ?? null;
}
