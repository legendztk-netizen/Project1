// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { EmailOtpAccessPage } from "../app/modules/customer-identity/ui/email-otp-access-page";
import ResetPassword from "../app/modules/customer-identity/routes/reset-password";
import {
  privacyContactEmail,
  privacyNoticeCookies,
  privacyNoticeOperator,
} from "../app/modules/storefront/domain/privacy-notice";
import PrivacyNotice from "../app/modules/storefront/routes/privacy-notice";

afterEach(cleanup);

function show(element: React.ReactElement) {
  render(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />,
  );
}

it("names the Seller of Record with its configured registered address", () => {
  expect(privacyNoticeOperator("Hangzhou,zhejiang,,310000\nChina")).toBe(
    "Hangzhou Rongyao Trading Co., Ltd., Hangzhou, zhejiang, 310000, China",
  );
  expect(privacyNoticeOperator(null)).toBe(
    "Hangzhou Rongyao Trading Co., Ltd.",
  );
});

it("names the operator, the IP records, every cookie and a contact address", () => {
  show(
    <PrivacyNotice
      {...({
        loaderData: {
          appName: "Hydraulic Supply",
          operator: privacyNoticeOperator("1 Example Road\nHangzhou\nChina"),
        },
      } as Parameters<typeof PrivacyNotice>[0])}
    />,
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain(
    "Hydraulic Supply at customhoseco.com is operated by Hangzhou Rongyao Trading Co., Ltd., 1 Example Road, Hangzhou, China",
  );
  // PI acceptance captures a typed name only; there is no title field.
  expect(text).toContain("Proforma Invoice acceptance: the name you type,");
  expect(text).not.toContain("business title");
  expect(text).toContain(
    "request a delivery address or shipping plan change, we record your IP address with the request",
  );
  expect(text).toContain(
    "the IP address you registered from, and the time, method and IP address of your most recent sign-in",
  );
  expect(privacyNoticeCookies.map((cookie) => cookie.name)).toEqual([
    "hs_customer_session",
    "hs_quote_session",
    "hs_password_authorization",
  ]);
  for (const cookie of privacyNoticeCookies)
    expect(text).toContain(cookie.name);
  expect(text).toContain("Expires after 30 days.");
  expect(text).toContain("Expires after 10 minutes.");
  expect(
    screen
      .getByRole("link", { name: privacyContactEmail })
      .getAttribute("href"),
  ).toBe("mailto:privacy@customhoseco.com");
});

it("tells customers about the IP record where they register and sign in", () => {
  for (const purpose of ["register", "sign_in"] as const) {
    show(<EmailOtpAccessPage purpose={purpose} returnTo="/account" />);
    expect(
      screen.getByText(
        /We record the IP address you register and sign in from/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Privacy Notice" }).getAttribute("href"),
    ).toBe("/policies/privacy");
    cleanup();
  }
});

it("says a Forgot password reset signs in and records the IP, but not a signed-in reset", () => {
  const page = (scope: "password_reset" | "password_change") =>
    show(
      <ResetPassword
        {...({
          loaderData: {
            authorization: {
              email: "buyer@example.test",
              id: "authorization",
              profileId: "buyer",
              scope,
            },
          },
        } as unknown as Parameters<typeof ResetPassword>[0])}
      />,
    );
  page("password_reset");
  expect(
    screen.getByText(/Saving signs you in\. We record the IP address/),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Privacy Notice" }).getAttribute("href"),
  ).toBe("/policies/privacy");
  cleanup();
  page("password_change");
  expect(screen.queryByText(/Saving signs you in/)).toBeNull();
});
