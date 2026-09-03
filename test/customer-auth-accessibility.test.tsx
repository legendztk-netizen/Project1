// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import {
  EmailOtpAccessPage,
  type EmailOtpActionData,
} from "../app/modules/customer-identity/ui/email-otp-access-page";

function renderAccessPage(input: {
  actionData?: EmailOtpActionData;
  initialMethod?: "email-code" | "password";
  purpose?: "register" | "sign_in";
}) {
  const router = createMemoryRouter(
    [
      {
        children: [
          {
            element: (
              <EmailOtpAccessPage
                actionData={input.actionData}
                initialMethod={input.initialMethod}
                purpose={input.purpose ?? "sign_in"}
                returnTo="/quote-list"
              />
            ),
            path: "sign-in",
          },
        ],
        element: <Outlet />,
        id: "root",
        loader: () => ({ customer: null }) satisfies RootLoaderData,
        path: "/",
      },
    ],
    { initialEntries: ["/sign-in"] },
  );

  render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("Customer authentication accessibility", () => {
  it("labels and focuses the email-code entry point", async () => {
    renderAccessPage({});

    const email = await screen.findByRole("textbox", {
      name: "Email address",
    });
    expect(document.activeElement).toBe(email);
    expect(email.getAttribute("autocomplete")).toBe("email");
    expect(
      screen.getByRole("button", { name: "Send email code" }),
    ).toBeTruthy();

    const methods = screen.getByRole("navigation", {
      name: "Sign-in method",
    });
    expect(
      within(methods)
        .getByRole("link", { name: "Email code" })
        .getAttribute("aria-current"),
    ).toBe("page");
    const passwordMethod = within(methods).getByRole("link", {
      name: "Password",
    });
    expect(passwordMethod.getAttribute("href")).toBe(
      "/sign-in?method=password&returnTo=%2Fquote-list",
    );
    passwordMethod.focus();
    expect(document.activeElement).toBe(passwordMethod);
  });

  it("announces OTP errors and focuses the six-digit field", async () => {
    renderAccessPage({
      actionData: {
        challengeId: "challenge-1",
        email: "buyer@example.com",
        error: "That code is invalid or has expired.",
        step: "verify",
      },
      purpose: "register",
    });

    const code = await screen.findByRole("textbox", {
      name: "Verification code",
    });
    expect(document.activeElement).toBe(code);
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(code.getAttribute("pattern")).toBe("[0-9]{6}");
    expect(screen.getByRole("alert").textContent).toContain(
      "invalid or has expired",
    );
  });

  it("keeps password sign-in and recovery keyboard reachable", async () => {
    renderAccessPage({ initialMethod: "password" });

    const email = await screen.findByRole("textbox", {
      name: "Email address",
    });
    const password = screen.getByLabelText("Password");
    const recovery = screen.getByRole("link", { name: "Forgot password?" });

    expect(document.activeElement).toBe(email);
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    password.focus();
    expect(document.activeElement).toBe(password);
    recovery.focus();
    expect(document.activeElement).toBe(recovery);
    expect(recovery.getAttribute("href")).toBe("/forgot-password");
  });
});
