export const SELLER_LEGAL_NAME = "Hangzhou Rongyao Trading Co., Ltd.";
export const RETURN_LOCATION_PURPOSE =
  "Approved returns only; not the seller registered address, warehouse, store, sales office, or pickup point.";

export type PaymentChannel = "bank_transfer" | "paypal";
export type VersionStatus = "current" | "superseded";

export interface SellerIdentityVersion {
  createdAt: string;
  createdBy: string;
  id: string;
  legalName: typeof SELLER_LEGAL_NAME;
  registeredAddressEn: string | null;
  registeredCountryCode: "CN";
  status: VersionStatus;
  supersededAt: string | null;
  version: number;
}

export interface PaymentInstructionVersion {
  channel: PaymentChannel;
  createdAt: string;
  createdBy: string;
  id: string;
  instructions: string;
  status: VersionStatus;
  supersededAt: string | null;
  version: number;
}

export interface SellerReturnLocation {
  address: string;
  id: string;
  label: string;
  phone: string;
  purpose: string;
}

export interface ValidatedReturnLocation {
  address: string;
  label: string;
  phone: string;
}

function normalizedMultiline(value: string) {
  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function validatedEnglishChinaRegisteredAddress(value: string) {
  const address = normalizedMultiline(value);
  if (!/^[\x20-\x7E\n]+$/u.test(address)) {
    throw new Error("China registered address must be entered in English");
  }
  if (address.length < 10 || address.length > 1000) {
    throw new Error(
      "English China registered address must be 10-1000 characters",
    );
  }
  if (
    !/\bChina\b/iu.test(address) ||
    /\bUnited States\b|\bPlano\b|542\s+Haggard/iu.test(address)
  ) {
    throw new Error(
      "Registered address must identify the China legal address, not a return location",
    );
  }
  return address;
}

export function validatedPaymentInstructions(value: string) {
  const instructions = normalizedMultiline(value);
  if (instructions.length < 5 || instructions.length > 4000) {
    throw new Error("Payment Instructions must be 5-4000 characters");
  }
  return instructions;
}

export function validatedReturnLocation(input: {
  address: string;
  label: string;
  phone: string;
}): ValidatedReturnLocation {
  const label = input.label.trim().replaceAll(/\s+/gu, " ");
  const address = normalizedMultiline(input.address);
  const phone = input.phone.trim().replaceAll(/\s+/gu, " ");
  if (label.length < 2 || label.length > 100) {
    throw new Error("Return location name must be 2-100 characters");
  }
  if (address.length < 10 || address.length > 1000) {
    throw new Error("Return address must be 10-1000 characters");
  }
  if (phone.length < 5 || phone.length > 50) {
    throw new Error("Return contact phone must be 5-50 characters");
  }
  return { address, label, phone };
}

export function paymentChannel(value: string): PaymentChannel {
  if (value === "bank_transfer" || value === "paypal") return value;
  throw new Error("Payment channel must be Bank Transfer or PayPal");
}

export function sellerIdentityReadyForPi(
  identity: SellerIdentityVersion | null,
) {
  const address = identity?.registeredAddressEn?.trim() ?? "";
  return Boolean(
    identity &&
    identity.legalName === SELLER_LEGAL_NAME &&
    identity.registeredCountryCode === "CN" &&
    address.length >= 10 &&
    /\bChina\b/iu.test(address) &&
    !/\bUnited States\b|\bPlano\b|542\s+Haggard/iu.test(address) &&
    !/PLACEHOLDER|REPLACE[-_ ]?WITH|EXAMPLE\.INVALID/iu.test(address),
  );
}

export function paymentInstructionsReadyForPi(
  version: PaymentInstructionVersion | null,
) {
  const instructions = version?.instructions.trim() ?? "";
  return Boolean(
    version?.status === "current" &&
    instructions.length >= 5 &&
    !/PLACEHOLDER|REPLACE[-_ ]?WITH|EXAMPLE\.INVALID/iu.test(instructions),
  );
}
