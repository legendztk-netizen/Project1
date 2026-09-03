import { describe, expect, it } from "vitest";

import {
  SELLER_LEGAL_NAME,
  paymentChannel,
  paymentInstructionsReadyForPi,
  sellerIdentityReadyForPi,
  validatedEnglishChinaRegisteredAddress,
  validatedPaymentInstructions,
  validatedReturnLocation,
  type PaymentInstructionVersion,
  type SellerIdentityVersion,
} from "../app/modules/seller-settings/domain/seller-commercial-settings";

function identity(address: string | null): SellerIdentityVersion {
  return {
    createdAt: "2026-09-03T00:00:00.000Z",
    createdBy: "admin-owner",
    id: "seller-v2",
    legalName: SELLER_LEGAL_NAME,
    registeredAddressEn: address,
    registeredCountryCode: "CN",
    status: "current",
    supersededAt: null,
    version: 2,
  };
}

function payment(instructions: string): PaymentInstructionVersion {
  return {
    channel: "bank_transfer",
    createdAt: "2026-09-03T00:00:00.000Z",
    createdBy: "admin-owner",
    id: "bank-v1",
    instructions,
    status: "current",
    supersededAt: null,
    version: 1,
  };
}

describe("Seller commercial settings", () => {
  it("requires a real English China registered address for PI readiness", () => {
    expect(sellerIdentityReadyForPi(identity(null))).toBe(false);
    expect(
      sellerIdentityReadyForPi(
        identity("CHINA REGISTERED ADDRESS PLACEHOLDER\nHangzhou, China"),
      ),
    ).toBe(false);
    expect(
      sellerIdentityReadyForPi(
        identity("Room 101, Example Road, Hangzhou, Zhejiang, China"),
      ),
    ).toBe(true);
    expect(
      sellerIdentityReadyForPi(
        identity("542 Haggard St, Suite 505\nPlano, TX 75074\nUnited States"),
      ),
    ).toBe(false);
    expect(() =>
      validatedEnglishChinaRegisteredAddress("杭州市某某路"),
    ).toThrow("entered in English");
    expect(() =>
      validatedEnglishChinaRegisteredAddress(
        "542 Haggard St, Suite 505\nPlano, TX 75074\nUnited States",
      ),
    ).toThrow("not a return location");
  });

  it("normalizes multiline payment instructions and rejects placeholders", () => {
    expect(
      validatedPaymentInstructions(
        "  Beneficiary: Example Co.  \r\n IBAN: 123 ",
      ),
    ).toBe("Beneficiary: Example Co.\nIBAN: 123");
    expect(
      paymentInstructionsReadyForPi(payment("BANK DETAILS PLACEHOLDER")),
    ).toBe(false);
    expect(
      paymentInstructionsReadyForPi(
        payment("Beneficiary: Rongyao\nAccount: 123"),
      ),
    ).toBe(true);
  });

  it("keeps payment channels explicit", () => {
    expect(paymentChannel("bank_transfer")).toBe("bank_transfer");
    expect(paymentChannel("paypal")).toBe("paypal");
    expect(() => paymentChannel("wire")).toThrow("Bank Transfer or PayPal");
  });

  it("validates editable return locations", () => {
    expect(
      validatedReturnLocation({
        address: "  100 Test Street\r\n Dallas, TX 75001  ",
        label: "  Dallas   Returns  ",
        phone: " +1 555 0100 ",
      }),
    ).toEqual({
      address: "100 Test Street\nDallas, TX 75001",
      label: "Dallas Returns",
      phone: "+1 555 0100",
    });
    expect(() =>
      validatedReturnLocation({
        address: "short",
        label: "A",
        phone: "1",
      }),
    ).toThrow("name must be 2-100 characters");
  });
});
