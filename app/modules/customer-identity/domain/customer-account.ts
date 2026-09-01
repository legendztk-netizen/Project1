export type PurchasingContextKind = "individual" | "organization";

export const COUNTRY_CODES =
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(
    " ",
  );

const countryCodes = new Set(COUNTRY_CODES);

export interface DeliveryAddressDraft {
  addressLine1: string;
  addressLine2: string;
  city: string;
  countryCode: string;
  label: string;
  postalCode: string;
  recipientEmail: string;
  recipientName: string;
  recipientPhone: string;
  stateProvince: string;
}

export interface OrganizationDraft {
  countryCode: string;
  legalName: string;
  registrationOrTaxId: string;
  tradeName: string;
}

export interface DeliveryAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  countryCode: string;
  id: string;
  isSelected: boolean;
  label: string;
  postalCode: string;
  recipientEmail: string;
  recipientName: string;
  recipientPhone: string;
  stateProvince: string;
}

export interface PurchasingContext {
  countryCode: string | null;
  id: string;
  isSelected: boolean;
  kind: PurchasingContextKind;
  legalName: string | null;
  primaryContactEmail: string;
  primaryContactName: string;
  registrationOrTaxId: string | null;
  tradeName: string | null;
}

export class CustomerAccountValidationError extends Error {}

function normalizedText(
  value: string,
  maximumLength: number,
  label: string,
  required = true,
) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (required && normalized.length === 0) {
    throw new CustomerAccountValidationError(`${label} is required.`);
  }
  if (normalized.length > maximumLength) {
    throw new CustomerAccountValidationError(
      `${label} must be ${maximumLength} characters or fewer.`,
    );
  }
  return normalized;
}

function normalizedCountryCode(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!countryCodes.has(normalized)) {
    throw new CustomerAccountValidationError(
      "Select a valid country or region.",
    );
  }
  return normalized;
}

function normalizedEmail(value: string) {
  const normalized = normalizedText(
    value,
    254,
    "Recipient email",
  ).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new CustomerAccountValidationError(
      "Recipient email must be a valid email address.",
    );
  }
  return normalized;
}

export function validatedDeliveryAddress(input: DeliveryAddressDraft) {
  return {
    addressLine1: normalizedText(input.addressLine1, 160, "Street address"),
    addressLine2: normalizedText(
      input.addressLine2,
      160,
      "Apartment, suite or unit",
      false,
    ),
    city: normalizedText(input.city, 100, "City"),
    countryCode: normalizedCountryCode(input.countryCode),
    label: normalizedText(input.label, 60, "Address label"),
    postalCode: normalizedText(input.postalCode, 24, "Postal code"),
    recipientEmail: normalizedEmail(input.recipientEmail),
    recipientName: normalizedText(input.recipientName, 120, "Recipient name"),
    recipientPhone: normalizedText(
      input.recipientPhone,
      40,
      "Recipient phone number",
    ),
    stateProvince: normalizedText(input.stateProvince, 100, "State / province"),
  };
}

export function validatedOrganization(input: OrganizationDraft) {
  return {
    countryCode: normalizedCountryCode(input.countryCode),
    legalName: normalizedText(input.legalName, 180, "Legal company name"),
    registrationOrTaxId: normalizedText(
      input.registrationOrTaxId,
      80,
      "Registration / tax ID",
      false,
    ),
    tradeName: normalizedText(input.tradeName, 180, "Trade name", false),
  };
}
