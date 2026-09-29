import { describe, expect, it } from "vitest";

import {
  CustomerAccountValidationError,
  validatedDeliveryAddress,
  validatedOrganization,
} from "../app/modules/customer-identity/domain/customer-account";

describe("customer account records", () => {
  it("normalizes complete Delivery Addresses", () => {
    expect(
      validatedDeliveryAddress({
        addressLine1: "  200   Park Avenue ",
        addressLine2: " Suite 900 ",
        city: " New York ",
        countryCode: " us ",
        label: " Main warehouse ",
        postalCode: " 10166 ",
        recipientEmail: " BUYER@EXAMPLE.COM ",
        recipientName: " Morgan   Buyer ",
        recipientPhone: " +1 212 555 0109 ",
        stateProvince: " New York ",
      }),
    ).toEqual({
      addressLine1: "200 Park Avenue",
      addressLine2: "Suite 900",
      city: "New York",
      countryCode: "US",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "buyer@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "NY",
    });
  });

  it("validates US states and ZIP codes but keeps other countries free-form", () => {
    const address = {
      addressLine1: "200 Park Avenue",
      addressLine2: "",
      city: "New York",
      countryCode: "US",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "buyer@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "ny",
    };
    expect(validatedDeliveryAddress(address)).toMatchObject({
      stateProvince: "NY",
      postalCode: "10166",
    });
    expect(
      validatedDeliveryAddress({ ...address, postalCode: "101661234" }),
    ).toMatchObject({ postalCode: "10166-1234" });
    expect(() =>
      validatedDeliveryAddress({ ...address, stateProvince: "Nowhere" }),
    ).toThrow("Select a valid US state or territory.");
    expect(() =>
      validatedDeliveryAddress({ ...address, postalCode: "1016" }),
    ).toThrow("Enter a valid US ZIP code");
    expect(
      validatedDeliveryAddress({
        ...address,
        countryCode: "CA",
        stateProvince: "Ontario",
        postalCode: "M5V 2T6",
      }),
    ).toMatchObject({ stateProvince: "Ontario", postalCode: "M5V 2T6" });
  });

  it.each([
    ["recipientName", "Recipient name is required."],
    ["recipientEmail", "Recipient email is required."],
    ["stateProvince", "State / province is required."],
    ["addressLine1", "Street address is required."],
  ] as const)("rejects an incomplete %s", (field, message) => {
    const address = {
      addressLine1: "200 Park Avenue",
      addressLine2: "",
      city: "New York",
      countryCode: "US",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "buyer@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    };
    address[field] = "";
    expect(() => validatedDeliveryAddress(address)).toThrow(message);
  });

  it("keeps optional organization identifiers separate from required identity", () => {
    expect(
      validatedOrganization({
        countryCode: "us",
        legalName: " Acme   Hydraulics LLC ",
        registrationOrTaxId: " ",
        tradeName: " Acme Hose ",
      }),
    ).toEqual({
      countryCode: "US",
      legalName: "Acme Hydraulics LLC",
      registrationOrTaxId: "",
      tradeName: "Acme Hose",
    });
    expect(() =>
      validatedOrganization({
        countryCode: "USA",
        legalName: "",
        registrationOrTaxId: "",
        tradeName: "",
      }),
    ).toThrow(CustomerAccountValidationError);
  });

  it("rejects unsupported country codes and overlong recipient emails", () => {
    const address = {
      addressLine1: "200 Park Avenue",
      addressLine2: "",
      city: "New York",
      countryCode: "QQ",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "buyer@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    };

    expect(() => validatedDeliveryAddress(address)).toThrow(
      "Select a valid country or region.",
    );
    expect(() =>
      validatedDeliveryAddress({
        ...address,
        countryCode: "US",
        recipientEmail: `${"a".repeat(244)}@example.com`,
      }),
    ).toThrow("Recipient email must be 254 characters or fewer.");
  });
});
