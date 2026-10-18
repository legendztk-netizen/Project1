import { expect, it } from "vitest";

import { customerSignInAccess } from "../app/modules/customer-identity/domain/customer-access";

it("keeps Cloudflare's location as reported and drops values it cannot store", () => {
  expect(
    customerSignInAccess({
      ip: " 2001:db8::1 ",
      location: { country: "us", region: " Texas ", city: "Houston" },
      method: "password",
    }),
  ).toEqual({
    ip: "2001:db8::1",
    country: "US",
    region: "Texas",
    city: "Houston",
    method: "password",
  });
  expect(
    customerSignInAccess({
      ip: null,
      location: { country: "United States", region: "", city: "x".repeat(150) },
      method: "email_code",
    }),
  ).toEqual({
    ip: null,
    country: null,
    region: null,
    city: "x".repeat(100),
    method: "email_code",
  });
  expect(
    customerSignInAccess({ ip: "203.0.113.9", method: "password_reset" }),
  ).toMatchObject({ ip: "203.0.113.9", country: null, city: null });
});
