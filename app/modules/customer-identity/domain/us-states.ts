// USPS state, district, territory and military codes accepted for US delivery.
export const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["AS", "American Samoa"],
  ["GU", "Guam"],
  ["MP", "Northern Mariana Islands"],
  ["PR", "Puerto Rico"],
  ["VI", "U.S. Virgin Islands"],
  ["AA", "Armed Forces Americas"],
  ["AE", "Armed Forces Europe"],
  ["AP", "Armed Forces Pacific"],
] as const;

const byKey = new Map<string, string>(
  US_STATES.flatMap(([code, name]) => [
    [code, code],
    [name.toUpperCase(), code],
  ]),
);

// Returns the USPS code for a US state code or full name, or null if unknown.
export function usStateCode(value: string) {
  return byKey.get(value.trim().replace(/\s+/g, " ").toUpperCase()) ?? null;
}

// Returns a normalized US ZIP or ZIP+4 code, or null if the format is invalid.
export function usZipCode(value: string) {
  const digits = value.trim().replace(/\s+/g, "");
  const match = /^(\d{5})(?:-?(\d{4}))?$/.exec(digits);
  if (!match) return null;
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}
