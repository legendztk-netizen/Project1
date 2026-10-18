// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { EmailOtpAccessPage } from "../app/modules/customer-identity/ui/email-otp-access-page";
import {
  privacyContactEmail,
  privacyNoticeCookies,
} from "../app/modules/storefront/domain/privacy-notice";
import PrivacyNotice from "../app/modules/storefront/routes/privacy-notice";

afterEach(cleanup);

function show(element: React.ReactElement) {
  render(
    <RouterProvider router={createMemoryRouter([{ path: "/", element }])} />,
  );
}

it("names the seller, the sign-in IP record, every cookie and a contact address", () => {
  show(
    <PrivacyNotice
      {...({ loaderData: { appName: "Hydraulic Supply" } } as Parameters<
        typeof PrivacyNotice
      >[0])}
    />,
  );
  const text = document.body.textContent ?? "";
  expect(text).toContain(
    "Hydraulic Supply at customhoseco.com is operated by Hangzhou Rongyao Trading Co., Ltd.",
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
