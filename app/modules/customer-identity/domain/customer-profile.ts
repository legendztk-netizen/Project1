export interface CustomerContactProfile {
  email: string;
  fullName: string;
  id: string;
  phoneNumber: string;
  verifiedAt: string;
}

export class CustomerProfileValidationError extends Error {}

function optionalText(value: string, maximumLength: number, label: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maximumLength) {
    throw new CustomerProfileValidationError(
      `${label} must be ${maximumLength} characters or fewer.`,
    );
  }
  return normalized;
}

export function validatedCustomerContact(input: {
  fullName: string;
  phoneNumber: string;
}) {
  return {
    fullName: optionalText(input.fullName, 120, "Name"),
    phoneNumber: optionalText(input.phoneNumber, 40, "Phone number"),
  };
}
