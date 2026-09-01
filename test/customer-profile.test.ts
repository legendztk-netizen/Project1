import { describe, expect, it } from "vitest";

import {
  CustomerProfileValidationError,
  validatedCustomerContact,
} from "../app/modules/customer-identity/domain/customer-profile";

describe("customer contact profile", () => {
  it("normalizes optional customer contact fields", () => {
    expect(
      validatedCustomerContact({
        fullName: "  Taylor   Rivera  ",
        phoneNumber: "  +1 212 555 0184  ",
      }),
    ).toEqual({
      fullName: "Taylor Rivera",
      phoneNumber: "+1 212 555 0184",
    });
  });

  it("rejects oversized contact fields", () => {
    expect(() =>
      validatedCustomerContact({
        fullName: "x".repeat(121),
        phoneNumber: "",
      }),
    ).toThrow(CustomerProfileValidationError);
  });
});
