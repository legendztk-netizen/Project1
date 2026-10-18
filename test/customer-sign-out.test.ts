import { expect, it } from "vitest";

import { loader } from "../app/modules/customer-identity/routes/sign-out";

it("sends a GET of the sign-out route back to the account page instead of failing", () => {
  const response = loader();
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/account");
});
