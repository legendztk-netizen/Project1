import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as XLSX from "@e965/xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const host = "127.0.0.1";
let port: number;
let origin: string;
let persistenceDirectory: string;
let preview: ChildProcess;
let previewExit: Promise<number | null>;

interface D1QueryResult<T> {
  results: T[];
  success: boolean;
}

function runLocalD1<T>(sql: string) {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(process.cwd(), "wrangler.jsonc"),
      "--local",
      "--persist-to",
      persistenceDirectory,
      "--command",
      sql,
      "--json",
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const payload = JSON.parse(result.stdout) as Array<D1QueryResult<T>>;
  expect(payload[0]?.success).toBe(true);
  return payload[0]?.results ?? [];
}

function runLocalD1Failure(sql: string) {
  const result = spawnSync(
    join(process.cwd(), "node_modules", ".bin", "wrangler"),
    [
      "d1",
      "execute",
      "hydraulic-hose-rfq-local",
      "--config",
      join(process.cwd(), "wrangler.jsonc"),
      "--local",
      "--persist-to",
      persistenceDirectory,
      "--command",
      sql,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
  expect(result.status).not.toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

function cookieHeader(response: Response) {
  const setCookie = response.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return setCookie?.split(";", 1)[0] ?? "";
}

function sessionIdFromCookie(cookie: string) {
  const value = cookie.slice(cookie.indexOf("=") + 1);
  return decodeURIComponent(value).split(".", 1)[0] ?? "";
}

function renderedText(html: string) {
  return html
    .replaceAll("<!-- -->", "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sqlText(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function otpChallengeFromHtml(html: string) {
  const challengeId = html.match(
    /name="challengeId"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="challengeId"/,
  );
  const code = html.match(/<strong>(\d{6})<\/strong>/);
  const id = challengeId?.[1] ?? challengeId?.[2];
  expect(id).toBeTruthy();
  expect(code?.[1]).toMatch(/^\d{6}$/);
  return { challengeId: id ?? "", code: code?.[1] ?? "" };
}

function registrationTransactionFromHtml(html: string) {
  const match = html.match(
    /name="registrationTransactionId"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="registrationTransactionId"/,
  );
  const id = match?.[1] ?? match?.[2];
  expect(id).toBeTruthy();
  return id ?? "";
}

async function requestEmailOtp(input: {
  cookie?: string;
  email: string;
  ip?: string;
  path: "/forgot-password" | "/register" | "/sign-in";
}) {
  const form = new FormData();
  form.set("intent", "request");
  form.set("email", input.email);
  form.set("returnTo", "/account");
  const response = await fetch(`${origin}${input.path}`, {
    body: form,
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      origin,
      "x-forwarded-for": input.ip ?? `smoke-test:${input.email}`,
    },
    method: "POST",
  });
  const html = await response.text();
  return {
    challenge: response.ok ? otpChallengeFromHtml(html) : null,
    html,
    response,
  };
}

async function requestDraftRegistration(input: {
  cookie?: string;
  email: string;
  snapshot: string;
}) {
  const form = new FormData();
  form.set("intent", "request-configuration-registration");
  form.set("email", input.email);
  form.set("returnTo", "/catalog/hydraulic-hose");
  form.set("registrationSnapshot", input.snapshot);
  const response = await fetch(`${origin}/register`, {
    body: form,
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      origin,
      "x-forwarded-for": `draft-registration:${input.email}`,
    },
    method: "POST",
  });
  const html = await response.text();
  return {
    challenge: response.ok ? otpChallengeFromHtml(html) : null,
    html,
    response,
    transactionId: response.ok ? registrationTransactionFromHtml(html) : null,
  };
}

async function verifyEmailOtp(input: {
  challengeId: string;
  code: string;
  cookie?: string;
  path: "/forgot-password" | "/register" | "/sign-in";
  returnTo?: string;
}) {
  const form = new FormData();
  form.set("intent", "verify");
  form.set("challengeId", input.challengeId);
  form.set("code", input.code);
  form.set("returnTo", input.returnTo ?? "/account");
  return fetch(`${origin}${input.path}`, {
    body: form,
    headers: {
      ...(input.cookie ? { cookie: input.cookie } : {}),
      origin,
    },
    method: "POST",
    redirect: "manual",
  });
}

function quoteFormFromProductDetail(html: string) {
  const command = html.indexOf('data-command="add-to-quote"');
  const start = html.lastIndexOf("<form", command);
  const end = html.indexOf("</form>", command);
  expect(command).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(command);
  const markup = html.slice(start, end + "</form>".length);
  const action = markup.match(/action="([^"]+)"/)?.[1];
  expect(action).toBe("/quote-list");

  const form = new FormData();
  for (const input of markup.matchAll(
    /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g,
  )) {
    form.set(input[1] ?? "", input[2] ?? "");
  }
  expect(form.get("intent")).toBe("add");
  expect(form.get("sku")).toBe("JIC_F_SW_04_04");
  expect(form.get("quantity")).toBe("1");
  return { action: action ?? "", form };
}

async function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local preview port"));
        return;
      }

      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + 25_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch {
      // The workerd preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Cloudflare Worker preview did not become ready");
}

beforeAll(async () => {
  persistenceDirectory = await mkdtemp(join(tmpdir(), "hydraulic-hose-smoke-"));
  const migration = spawnSync(
    process.execPath,
    ["scripts/d1-migrations.mjs", "apply", "local"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, D1_PERSIST_TO: persistenceDirectory },
    },
  );
  expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0);

  port = await findAvailablePort();
  origin = `http://${host}:${port}`;
  preview = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "preview",
      "--host",
      host,
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      env: {
        ...process.env,
        CLOUDFLARE_PERSIST_PATH: persistenceDirectory,
      },
      // Vite and workerd can emit enough request logging to fill an unread pipe
      // during this long-running suite and stall the preview process.
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  previewExit = new Promise((resolve) => preview.once("exit", resolve));

  await Promise.race([
    waitUntilReady(),
    previewExit.then((code) => {
      throw new Error(
        `Cloudflare Worker preview exited early with code ${code}`,
      );
    }),
  ]);
});

afterAll(async () => {
  if (preview && preview.exitCode === null) {
    preview.kill("SIGTERM");
    await previewExit;
  }
  if (persistenceDirectory) {
    await rm(persistenceDirectory, { force: true, recursive: true });
  }
});

describe("Cloudflare Worker route surfaces", () => {
  it("serves machine-readable health from the Worker", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("keeps the Storefront and Admin shells distinct", async () => {
    const [storefrontResponse, adminResponse, adminDataResponse] =
      await Promise.all([
        fetch(origin),
        fetch(`${origin}/admin`),
        fetch(`${origin}/admin.data`),
      ]);
    expect(storefrontResponse.status).toBe(200);
    expect(adminResponse.status).toBe(200);
    expect(adminDataResponse.status).toBe(200);

    const [storefront, admin] = await Promise.all([
      storefrontResponse.text(),
      adminResponse.text(),
    ]);

    expect(storefront).toContain('data-surface="storefront"');
    expect(storefront).not.toContain('data-surface="admin"');
    expect(storefront).toContain('href="/catalog/hydraulic-hose"');
    expect(admin).toContain('data-surface="admin"');
    expect(admin).not.toContain('data-surface="storefront"');
    expect(admin).not.toContain('href="#"');
    expect(admin).toContain("owner@local.invalid");
    expect(admin).toContain("local-development");
  });

  it("registers and signs in through a single-use email OTP without leaking plaintext", async () => {
    const registerPage = await (await fetch(`${origin}/register`)).text();
    const signInPage = await (await fetch(`${origin}/sign-in`)).text();
    expect(registerPage).toContain("Create your account");
    expect(signInPage).toContain("Sign in to your account");
    expect(registerPage).toContain("Send email code");

    const requested = await requestEmailOtp({
      email: "first.customer@example.com",
      path: "/register",
    });
    expect(requested.response.status).toBe(200);
    const challenge = requested.challenge;
    if (!challenge) throw new Error("Expected a registration challenge");
    expect(requested.html).toContain("Local email delivery stub");
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_profiles WHERE email_normalized = 'first.customer@example.com'",
      ),
    ).toEqual([{ count: 0 }]);
    const [storedChallenge] = runLocalD1<{
      expires_in_seconds: number;
      otp_digest: string;
    }>(
      `SELECT otp_digest,
              CAST(strftime('%s', expires_at) - strftime('%s', created_at) AS INTEGER)
                AS expires_in_seconds
       FROM customer_otp_challenges WHERE id = '${challenge.challengeId}'`,
    );
    expect(storedChallenge?.otp_digest).not.toContain(challenge.code);
    expect(storedChallenge?.expires_in_seconds).toBe(600);

    const verified = await verifyEmailOtp({
      challengeId: challenge.challengeId,
      code: challenge.code,
      path: "/register",
      returnTo: "//evil.example/steal",
    });
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).toBe(
      "/account/security?welcome=1&returnTo=%2Faccount",
    );
    const customerCookie = cookieHeader(verified);
    expect(verified.headers.get("set-cookie")).toContain("HttpOnly");
    expect(verified.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(verified.headers.get("set-cookie")).not.toContain("Secure");
    const account = await fetch(`${origin}/account`, {
      headers: { cookie: customerCookie },
    });
    expect(account.status).toBe(200);
    const accountHtml = await account.text();
    expect(accountHtml).toContain("first.customer@example.com");
    expect(accountHtml).toContain("View Quote List");
    expect(accountHtml).toContain("View My Quotes");
    expect(accountHtml).toContain("View Orders");
    const accountLists = await fetch(`${origin}/quote-list`, {
      headers: { cookie: customerCookie },
    });
    expect(accountLists.status).toBe(200);
    const accountListsHtml = await accountLists.text();
    expect(accountListsHtml).toContain('aria-label="Account details"');
    expect(accountListsHtml).toContain('href="/account/security"');
    expect(accountListsHtml).toContain("first.customer@example.com");
    expect(accountListsHtml).not.toContain(">Sign In<");
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_profiles WHERE email_normalized = 'first.customer@example.com'",
      ),
    ).toEqual([{ count: 1 }]);

    const replay = await verifyEmailOtp({
      challengeId: challenge.challengeId,
      code: challenge.code,
      path: "/register",
    });
    expect(replay.status).toBe(422);

    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE id = '${challenge.challengeId}'`,
    );

    const signIn = await requestEmailOtp({
      email: "first.customer@example.com",
      path: "/sign-in",
    });
    const signInChallenge = signIn.challenge;
    if (!signInChallenge) throw new Error("Expected a sign-in challenge");
    const rotated = await verifyEmailOtp({
      challengeId: signInChallenge.challengeId,
      code: signInChallenge.code,
      cookie: customerCookie,
      path: "/sign-in",
    });
    expect(rotated.status).toBe(302);
    const rotatedCookie = cookieHeader(rotated);
    expect(rotatedCookie).not.toBe(customerCookie);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: customerCookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: rotatedCookie },
        })
      ).status,
    ).toBe(200);

    const signOut = await fetch(`${origin}/sign-out`, {
      headers: { cookie: rotatedCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(signOut.status).toBe(302);
    expect(signOut.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: rotatedCookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
  });

  it("keeps account details and profile updates scoped to the signed-in customer", async () => {
    const unauthenticated = await fetch(
      `${origin}/account?view=orders&profileId=another-customer`,
      { redirect: "manual" },
    );
    expect(unauthenticated.status).toBe(302);
    expect(unauthenticated.headers.get("location")).toContain("/sign-in?");

    async function register(email: string) {
      const request = await requestEmailOtp({ email, path: "/register" });
      if (!request.challenge) throw new Error("Expected registration OTP");
      const response = await verifyEmailOtp({
        challengeId: request.challenge.challengeId,
        code: request.challenge.code,
        path: "/register",
      });
      return cookieHeader(response);
    }

    const ownerCookie = await register("ticket05.owner@example.com");
    await register("ticket05.other@example.com");
    const [other] = runLocalD1<{ id: string }>(
      "SELECT id FROM customer_profiles WHERE email_normalized = 'ticket05.other@example.com'",
    );
    if (!other) throw new Error("Expected the other customer profile");

    const orders = await fetch(
      `${origin}/account?view=orders&profileId=${other.id}`,
      { headers: { cookie: ownerCookie } },
    );
    const ordersHtml = await orders.text();
    expect(orders.status).toBe(200);
    expect(ordersHtml).toContain("ticket05.owner@example.com");
    expect(ordersHtml).not.toContain("ticket05.other@example.com");
    expect(renderedText(ordersHtml)).toContain(
      "No paid and confirmed orders yet. Quote requests and unpaid PIs do not appear here.",
    );
    for (const label of [
      "Overview",
      "Quote List",
      "Saved Configurations",
      "My Quotes",
      "Orders",
      "Addresses",
      "Account Security",
      "Profile / Company",
    ]) {
      expect(renderedText(ordersHtml)).toContain(label);
    }

    const profileForm = new FormData();
    profileForm.set("fullName", "Morgan Buyer");
    profileForm.set("intent", "update_contact");
    profileForm.set("phoneNumber", "+1 212 555 0109");
    profileForm.set("profileId", other.id);
    const updated = await fetch(`${origin}/account?view=profile`, {
      body: profileForm,
      headers: { cookie: ownerCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(updated.status).toBe(302);
    expect(updated.headers.get("location")).toBe(
      "/account?view=profile&saved=1",
    );
    expect(
      runLocalD1<{
        email_normalized: string;
        full_name: string | null;
        phone_number: string | null;
      }>(
        `SELECT email_normalized, full_name, phone_number
         FROM customer_profiles
         WHERE email_normalized IN (
           'ticket05.owner@example.com', 'ticket05.other@example.com'
         ) ORDER BY email_normalized`,
      ),
    ).toEqual([
      {
        email_normalized: "ticket05.other@example.com",
        full_name: null,
        phone_number: null,
      },
      {
        email_normalized: "ticket05.owner@example.com",
        full_name: "Morgan Buyer",
        phone_number: "+1 212 555 0109",
      },
    ]);
    const profile = await fetch(`${origin}/account?view=profile`, {
      headers: { cookie: ownerCookie },
    });
    const profileHtml = await profile.text();
    expect(profileHtml).toContain("Morgan Buyer");
    expect(profileHtml).toContain("+1 212 555 0109");
    expect(profileHtml).toContain(
      "Purchasing contexts identify whether a quote is for you or an organization",
    );
  });

  it("maintains owned Delivery Addresses and Individual or Organization Purchasing Contexts", async () => {
    async function register(email: string) {
      const requested = await requestEmailOtp({ email, path: "/register" });
      if (!requested.challenge) throw new Error("Expected registration OTP");
      const response = await verifyEmailOtp({
        challengeId: requested.challenge.challengeId,
        code: requested.challenge.code,
        path: "/register",
      });
      return cookieHeader(response);
    }

    async function accountPost(cookie: string, view: string, values: object) {
      const form = new FormData();
      for (const [name, value] of Object.entries(values)) {
        form.set(name, String(value));
      }
      return fetch(`${origin}/account?view=${view}`, {
        body: form,
        headers: { cookie, origin },
        method: "POST",
        redirect: "manual",
      });
    }

    const ownerCookie = await register("ticket07.owner@example.com");
    const otherCookie = await register("ticket07.other@example.com");

    expect((await accountPost(ownerCookie, "profile", {})).status).toBe(400);

    const initialProfile = await fetch(`${origin}/account?view=profile`, {
      headers: { cookie: ownerCookie },
    });
    const initialProfileHtml = await initialProfile.text();
    expect(initialProfile.status).toBe(200);
    expect(renderedText(initialProfileHtml)).toContain("Individual purchase");
    expect(renderedText(initialProfileHtml)).toContain("Current context");

    const incomplete = await accountPost(ownerCookie, "addresses", {
      addressLine1: "200 Park Avenue",
      addressLine2: "",
      city: "",
      countryCode: "US",
      intent: "create_address",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "receiving@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    });
    expect(incomplete.status).toBe(422);
    expect(await incomplete.text()).toContain("City is required.");
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_delivery_addresses a
         INNER JOIN customer_profiles p ON p.id = a.profile_id
         WHERE p.email_normalized = 'ticket07.owner@example.com'`,
      ),
    ).toEqual([{ count: 0 }]);

    const mainAddress = {
      addressLine1: "200 Park Avenue",
      addressLine2: "Suite 900",
      city: "New York",
      countryCode: "US",
      intent: "create_address",
      label: "Main warehouse",
      postalCode: "10166",
      recipientEmail: "receiving@example.com",
      recipientName: "Morgan Buyer",
      recipientPhone: "+1 212 555 0109",
      stateProvince: "New York",
    };
    expect(
      (await accountPost(ownerCookie, "addresses", mainAddress)).status,
    ).toBe(302);
    expect(
      (
        await accountPost(ownerCookie, "addresses", {
          ...mainAddress,
          addressLine1: "50 Fremont Street",
          addressLine2: "",
          city: "San Francisco",
          label: "West receiving",
          postalCode: "94105",
          stateProvince: "California",
        })
      ).status,
    ).toBe(302);

    const addresses = runLocalD1<{
      id: string;
      label: string;
      selected: number;
    }>(
      `SELECT a.id, a.label,
              CASE WHEN pref.selected_delivery_address_id = a.id
                THEN 1 ELSE 0 END AS selected
       FROM customer_delivery_addresses a
       INNER JOIN customer_profiles p ON p.id = a.profile_id
       INNER JOIN customer_account_preferences pref ON pref.profile_id = p.id
       WHERE p.email_normalized = 'ticket07.owner@example.com'
       ORDER BY a.label`,
    );
    expect(addresses).toHaveLength(2);
    expect(
      addresses.find(({ label }) => label === "Main warehouse")?.selected,
    ).toBe(1);
    const main = addresses.find(({ label }) => label === "Main warehouse");
    const west = addresses.find(({ label }) => label === "West receiving");
    if (!main || !west) throw new Error("Expected both Delivery Addresses");

    expect(
      (
        await accountPost(otherCookie, "addresses", {
          ...mainAddress,
          addressLine1: "10 Other Street",
          city: "Boston",
          label: "Other customer address",
          postalCode: "02108",
          stateProvince: "Massachusetts",
        })
      ).status,
    ).toBe(302);
    const [otherAddress] = runLocalD1<{ id: string }>(
      `SELECT a.id FROM customer_delivery_addresses a
       INNER JOIN customer_profiles p ON p.id = a.profile_id
       WHERE p.email_normalized = 'ticket07.other@example.com'`,
    );
    if (!otherAddress) throw new Error("Expected other customer address");
    expect(
      runLocalD1Failure(
        `UPDATE customer_account_preferences
         SET selected_delivery_address_id = '${otherAddress.id}'
         WHERE profile_id = (
           SELECT id FROM customer_profiles
           WHERE email_normalized = 'ticket07.owner@example.com'
         )`,
      ),
    ).toContain("FOREIGN KEY constraint failed");

    expect(
      (
        await accountPost(ownerCookie, "addresses", {
          addressId: west.id,
          intent: "select_address",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await accountPost(ownerCookie, "addresses", {
          ...mainAddress,
          addressId: west.id,
          addressLine1: "88 Fremont Street",
          addressLine2: "Dock 4",
          city: "San Francisco",
          intent: "update_address",
          label: "West receiving updated",
          postalCode: "94105",
          stateProvince: "California",
        })
      ).status,
    ).toBe(302);
    expect(
      runLocalD1<{
        address_line_1: string;
        label: string;
        selected: number;
      }>(
        `SELECT a.address_line_1, a.label,
                CASE WHEN pref.selected_delivery_address_id = a.id
                  THEN 1 ELSE 0 END AS selected
         FROM customer_delivery_addresses a
         INNER JOIN customer_account_preferences pref
           ON pref.profile_id = a.profile_id
         WHERE a.id = '${west.id}'`,
      ),
    ).toEqual([
      {
        address_line_1: "88 Fremont Street",
        label: "West receiving updated",
        selected: 1,
      },
    ]);

    expect(
      (
        await accountPost(otherCookie, "addresses", {
          addressId: main.id,
          intent: "delete_address",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${origin}/account?view=addresses&editAddress=${main.id}`, {
          headers: { cookie: otherCookie },
        })
      ).status,
    ).toBe(404);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_delivery_addresses
         WHERE id = '${main.id}'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      (
        await accountPost(ownerCookie, "addresses", {
          addressId: main.id,
          intent: "delete_address",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await accountPost(ownerCookie, "addresses", {
          addressId: west.id,
          intent: "delete_address",
        })
      ).status,
    ).toBe(302);
    expect(
      runLocalD1<{
        address_count: number;
        selected_delivery_address_id: string | null;
      }>(
        `SELECT COUNT(a.id) AS address_count,
                pref.selected_delivery_address_id
         FROM customer_account_preferences pref
         INNER JOIN customer_profiles p ON p.id = pref.profile_id
         LEFT JOIN customer_delivery_addresses a
           ON a.id = '${west.id}' AND a.profile_id = p.id
         WHERE p.email_normalized = 'ticket07.owner@example.com'
         GROUP BY pref.selected_delivery_address_id`,
      ),
    ).toEqual([{ address_count: 0, selected_delivery_address_id: null }]);

    expect(
      (
        await accountPost(ownerCookie, "profile", {
          intent: "create_organization",
          legalName: "Acme Hydraulics LLC",
          organizationCountryCode: "US",
          registrationOrTaxId: "US-ACME-100",
          tradeName: "Acme Hose",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await accountPost(ownerCookie, "profile", {
          intent: "create_organization",
          legalName: "Northstar Fluid Power Inc.",
          organizationCountryCode: "CA",
          registrationOrTaxId: "",
          tradeName: "Northstar",
        })
      ).status,
    ).toBe(302);

    const contexts = runLocalD1<{
      id: string;
      kind: string;
      legal_name: string | null;
      selected: number;
    }>(
      `SELECT c.id, c.kind, o.legal_name,
              CASE WHEN pref.selected_purchasing_context_id = c.id
                THEN 1 ELSE 0 END AS selected
       FROM customer_profiles p
       INNER JOIN customer_account_preferences pref ON pref.profile_id = p.id
       INNER JOIN customer_purchasing_contexts c ON (
         c.individual_profile_id = p.id OR c.organization_id IN (
           SELECT organization_id FROM customer_organization_memberships
           WHERE profile_id = p.id AND status = 'active'
         )
       )
       LEFT JOIN customer_organizations o ON o.id = c.organization_id
       WHERE p.email_normalized = 'ticket07.owner@example.com'
       ORDER BY c.kind, o.legal_name`,
    );
    expect(contexts).toHaveLength(3);
    expect(contexts.filter(({ kind }) => kind === "organization")).toHaveLength(
      2,
    );
    expect(
      contexts.find(
        ({ legal_name }) => legal_name === "Northstar Fluid Power Inc.",
      )?.selected,
    ).toBe(1);
    expect(
      runLocalD1<{
        email_normalized: string;
        organization_count: number;
      }>(
        `SELECT p.email_normalized, COUNT(*) AS organization_count
         FROM customer_organization_memberships m
         INNER JOIN customer_profiles p ON p.id = m.profile_id
         WHERE p.email_normalized = 'ticket07.owner@example.com'
           AND m.role = 'primary_contact' AND m.status = 'active'
         GROUP BY p.email_normalized`,
      ),
    ).toEqual([
      {
        email_normalized: "ticket07.owner@example.com",
        organization_count: 2,
      },
    ]);

    const individual = contexts.find(({ kind }) => kind === "individual");
    const acme = contexts.find(
      ({ legal_name }) => legal_name === "Acme Hydraulics LLC",
    );
    if (!individual || !acme) throw new Error("Expected purchasing contexts");
    expect(
      (
        await accountPost(ownerCookie, "profile", {
          contextId: individual.id,
          intent: "select_context",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await accountPost(otherCookie, "profile", {
          contextId: acme.id,
          intent: "select_context",
        })
      ).status,
    ).toBe(404);
    const [otherIndividual] = runLocalD1<{ id: string }>(
      `SELECT c.id FROM customer_purchasing_contexts c
       INNER JOIN customer_profiles p ON p.id = c.individual_profile_id
       WHERE p.email_normalized = 'ticket07.other@example.com'`,
    );
    if (!otherIndividual) throw new Error("Expected other individual context");
    expect(
      runLocalD1Failure(
        `UPDATE customer_account_preferences
         SET selected_purchasing_context_id = '${otherIndividual.id}'
         WHERE profile_id = (
           SELECT id FROM customer_profiles
           WHERE email_normalized = 'ticket07.owner@example.com'
         )`,
      ),
    ).toContain("FOREIGN KEY constraint failed");
    runLocalD1(
      `UPDATE customer_organization_memberships
       SET status = 'inactive'
       WHERE organization_id = (
         SELECT id FROM customer_organizations
         WHERE legal_name = 'Acme Hydraulics LLC'
       ) AND profile_id = (
         SELECT id FROM customer_profiles
         WHERE email_normalized = 'ticket07.owner@example.com'
       )`,
    );
    expect(
      (
        await accountPost(ownerCookie, "profile", {
          contextId: acme.id,
          intent: "select_context",
        })
      ).status,
    ).toBe(404);
    runLocalD1(
      `UPDATE customer_organization_memberships
       SET status = 'active'
       WHERE organization_id = (
         SELECT id FROM customer_organizations
         WHERE legal_name = 'Acme Hydraulics LLC'
       ) AND profile_id = (
         SELECT id FROM customer_profiles
         WHERE email_normalized = 'ticket07.owner@example.com'
       )`,
    );
    expect(
      runLocalD1<{ selected_purchasing_context_id: string }>(
        `SELECT pref.selected_purchasing_context_id
         FROM customer_account_preferences pref
         INNER JOIN customer_profiles p ON p.id = pref.profile_id
         WHERE p.email_normalized = 'ticket07.owner@example.com'`,
      ),
    ).toEqual([{ selected_purchasing_context_id: individual.id }]);

    const profile = await fetch(`${origin}/account?view=profile`, {
      headers: { cookie: ownerCookie },
    });
    const profileHtml = renderedText(await profile.text());
    expect(profile.status).toBe(200);
    expect(profileHtml).toContain("Acme Hydraulics LLC");
    expect(profileHtml).toContain("Northstar Fluid Power Inc.");
    expect(profileHtml).toContain(
      "Primary contact: ticket07.owner@example.com",
    );
  });

  it("converts one attached registration draft exactly once and rejects invalid transaction states", async () => {
    const exactSnapshot = JSON.stringify({
      catalogContext: {
        releaseId: "draft-registration-release",
        releaseNumber: "CAT-DRAFT-1",
      },
      configuration: {
        catalogRelease: {
          id: "draft-registration-release",
          number: "CAT-DRAFT-1",
        },
        hose: {
          dash: "-3",
          equivalentStandard: "EN 853 1SN",
          familyKey: "601r1",
          familyName: "601R1 Hydraulic Hose",
          mediaKey: "601R1",
          nominalIdIn: 0.1875,
          performance: {
            temperatureMaxC: 100,
            temperatureMinC: -40,
            workingBar: 250,
            workingPsi: 3626,
          },
          primaryStandard: "SAE 100 R1AT",
          reinforcement: "Single wire braid",
          series: "601R1",
          sku: "601R1_001",
        },
      },
      quantityInput: "2",
      referenceContext: {
        assemblyEstimateScheduleVersion: 3,
        clockingConventionVersion: 2,
        installedProtectionVersion: null,
        measurementDiagramAssetVersion: "diagram-v4",
        measurementMethodVersion: 7,
        measurementOverlayVersion: "overlay-v2",
      },
      selectedFamilyKey: "601r1",
      selectedSku: "601R1_001",
      selectionProvenance: {
        endA: {
          catalogReleaseId: "draft-registration-release",
          hoseSku: "601R1_001",
        },
      },
      stage: "end-a",
      version: 1,
    });
    const requested = await requestDraftRegistration({
      email: "draft.owner@example.com",
      snapshot: exactSnapshot,
    });
    expect(requested.response.status, requested.html).toBe(200);
    if (!requested.challenge || !requested.transactionId) {
      throw new Error("Expected an attached registration transaction");
    }
    expect(
      runLocalD1<{
        expires_in_seconds: number;
        snapshot_json: string;
      }>(
        `SELECT snapshot_json,
                CAST(strftime('%s', expires_at) - strftime('%s', created_at) AS INTEGER)
                  AS expires_in_seconds
         FROM customer_registration_configuration_transactions
         WHERE id = '${requested.transactionId}'`,
      ),
    ).toEqual([{ expires_in_seconds: 86400, snapshot_json: exactSnapshot }]);
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_saved_configurations",
      ),
    ).toEqual([{ count: 0 }]);

    const verified = await verifyEmailOtp({
      challengeId: requested.challenge.challengeId,
      code: requested.challenge.code,
      path: "/register",
    });
    expect(verified.status).toBe(302);
    const registrationCookie = cookieHeader(verified);
    expect(
      runLocalD1<{
        converted_at: string;
        email_display: string;
        snapshot_json: string;
      }>(
        `SELECT t.converted_at, p.email_display, s.snapshot_json
         FROM customer_saved_configurations s
         INNER JOIN customer_profiles p ON p.id = s.profile_id
         INNER JOIN customer_registration_configuration_transactions t
           ON t.id = s.source_registration_transaction_id
         WHERE t.id = '${requested.transactionId}'`,
      ),
    ).toEqual([
      {
        converted_at: expect.any(String),
        email_display: "draft.owner@example.com",
        snapshot_json: exactSnapshot,
      },
    ]);
    const registrationSavedPage = await fetch(
      `${origin}/account?view=saved-configurations`,
      { headers: { cookie: registrationCookie } },
    );
    const registrationSavedMarkup = await registrationSavedPage.text();
    const registrationSavedHtml = renderedText(registrationSavedMarkup);
    expect(registrationSavedPage.status).toBe(200);
    expect(registrationSavedHtml).toContain("Saved during registration");
    expect(registrationSavedHtml).toContain("601R1 Hydraulic Hose");
    expect(registrationSavedMarkup).toContain(
      'href="/build-a-hose?savedConfiguration=',
    );
    expect(
      (
        await verifyEmailOtp({
          challengeId: requested.challenge.challengeId,
          code: requested.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_saved_configurations
         WHERE source_registration_transaction_id = '${requested.transactionId}'`,
      ),
    ).toEqual([{ count: 1 }]);

    const authenticatedAttempt = await requestDraftRegistration({
      cookie: registrationCookie,
      email: "already.signed.in@example.com",
      snapshot: exactSnapshot,
    });
    expect(authenticatedAttempt.response.status).toBe(422);
    expect(authenticatedAttempt.html).toContain(
      "This registration path is only available to guests.",
    );
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_otp_challenges WHERE email_normalized = 'already.signed.in@example.com'",
      ),
    ).toEqual([{ count: 0 }]);

    const expired = await requestDraftRegistration({
      email: "expired.draft@example.com",
      snapshot: exactSnapshot,
    });
    if (!expired.challenge || !expired.transactionId) {
      throw new Error("Expected an expiring registration transaction");
    }
    runLocalD1(
      `UPDATE customer_registration_configuration_transactions
       SET expires_at = '2000-01-01T00:00:00.000Z'
       WHERE id = '${expired.transactionId}'`,
    );
    expect(
      (
        await verifyEmailOtp({
          challengeId: expired.challenge.challengeId,
          code: expired.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_saved_configurations
         WHERE source_registration_transaction_id = '${expired.transactionId}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM customer_registration_configuration_transactions
         WHERE id = '${expired.transactionId}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_profiles WHERE email_normalized = 'expired.draft@example.com'",
      ),
    ).toEqual([{ count: 0 }]);

    const abandoned = await requestDraftRegistration({
      email: "abandoned.draft@example.com",
      snapshot: exactSnapshot,
    });
    if (!abandoned.challenge || !abandoned.transactionId) {
      throw new Error("Expected an abandonable registration transaction");
    }
    const abandonForm = new FormData();
    abandonForm.set("intent", "abandon-configuration-registration");
    abandonForm.set("challengeId", abandoned.challenge.challengeId);
    abandonForm.set("registrationTransactionId", abandoned.transactionId);
    const abandonedResponse = await fetch(`${origin}/register`, {
      body: abandonForm,
      headers: { origin },
      method: "POST",
      redirect: "manual",
    });
    expect(abandonedResponse.status).toBe(302);
    expect(
      (
        await verifyEmailOtp({
          challengeId: abandoned.challenge.challengeId,
          code: abandoned.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);

    const superseded = await requestDraftRegistration({
      email: "superseded.draft@example.com",
      snapshot: exactSnapshot,
    });
    if (!superseded.challenge || !superseded.transactionId) {
      throw new Error("Expected a supersedable registration transaction");
    }
    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE id = '${superseded.challenge.challengeId}'`,
    );
    expect(
      (
        await requestEmailOtp({
          email: "superseded.draft@example.com",
          path: "/register",
        })
      ).response.status,
    ).toBe(200);
    expect(
      (
        await verifyEmailOtp({
          challengeId: superseded.challenge.challengeId,
          code: superseded.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_saved_configurations
         WHERE source_registration_transaction_id = '${superseded.transactionId}'`,
      ),
    ).toEqual([{ count: 0 }]);
  }, 180_000);

  it("saves, resumes and deletes account-owned configurations without creating quote state", async () => {
    async function register(email: string) {
      const requested = await requestEmailOtp({ email, path: "/register" });
      if (!requested.challenge) {
        throw new Error(`Expected registration OTP: ${requested.html}`);
      }
      const response = await verifyEmailOtp({
        challengeId: requested.challenge.challengeId,
        code: requested.challenge.code,
        path: "/register",
      });
      expect(response.status, await response.clone().text()).toBe(302);
      return cookieHeader(response);
    }

    async function deleteSaved(cookie: string, id: string) {
      const form = new FormData();
      form.set("intent", "delete_saved_configuration");
      form.set("savedConfigurationId", id);
      return fetch(`${origin}/account?view=saved-configurations`, {
        body: form,
        headers: { cookie, origin },
        method: "POST",
        redirect: "manual",
      });
    }

    const snapshot = JSON.stringify({
      catalogContext: {
        releaseId: "saved-release-1",
        releaseNumber: "SAVED-CAT-1",
      },
      configuration: {
        catalogRelease: {
          id: "saved-release-1",
          number: "SAVED-CAT-1",
        },
        hose: {
          dash: "-3",
          equivalentStandard: "EN 853 1SN",
          familyKey: "601r1",
          familyName: "601R1 Hydraulic Hose",
          mediaKey: "601R1",
          nominalIdIn: 0.1875,
          performance: {
            temperatureMaxC: 100,
            temperatureMinC: -40,
            workingBar: 250,
            workingPsi: 3626,
          },
          primaryStandard: "SAE 100 R1AT",
          reinforcement: "Single wire braid",
          series: "601R1",
          sku: "601R1_001",
        },
      },
      quantityInput: "2",
      referenceContext: {
        assemblyEstimateScheduleVersion: 3,
        clockingConventionVersion: 2,
        installedProtectionVersion: null,
        measurementDiagramAssetVersion: null,
        measurementMethodVersion: null,
        measurementOverlayVersion: null,
      },
      selectedFamilyKey: "601r1",
      selectedSku: "601R1_001",
      selectionProvenance: {},
      stage: "end-a",
      version: 1,
    });
    const ownerCookie = await register("ticket08.owner@example.com");
    const otherCookie = await register("ticket08.other@example.com");
    const quoteLinesBefore = runLocalD1<{ count: number }>(
      "SELECT COUNT(*) AS count FROM anonymous_quote_lines",
    );

    const anonymousForm = new FormData();
    anonymousForm.set("commandId", "00000000-0000-4000-8000-000000000000");
    anonymousForm.set("snapshot", snapshot);
    expect(
      (
        await fetch(`${origin}/api/configurator/saved-configurations`, {
          body: anonymousForm,
          headers: { origin },
          method: "POST",
        })
      ).status,
    ).toBe(401);

    const saveForm = new FormData();
    const saveCommandId = "11111111-1111-4111-8111-111111111111";
    saveForm.set("commandId", saveCommandId);
    saveForm.set("snapshot", snapshot);
    const savedResponse = await fetch(
      `${origin}/api/configurator/saved-configurations`,
      {
        body: saveForm,
        headers: { cookie: ownerCookie, origin },
        method: "POST",
      },
    );
    expect(savedResponse.status).toBe(201);
    const savedResult = (await savedResponse.json()) as { id: string };
    expect(savedResult.id).toBeTruthy();
    const retriedSaveForm = new FormData();
    retriedSaveForm.set("commandId", saveCommandId);
    retriedSaveForm.set("snapshot", snapshot);
    const retriedSave = await fetch(
      `${origin}/api/configurator/saved-configurations`,
      {
        body: retriedSaveForm,
        headers: { cookie: ownerCookie, origin },
        method: "POST",
      },
    );
    expect(retriedSave.status).toBe(201);
    expect(await retriedSave.json()).toMatchObject({ id: savedResult.id });
    expect(
      runLocalD1<{
        snapshot_json: string;
        command_id: string | null;
        source_kind: string;
        source_registration_transaction_id: string | null;
      }>(
        `SELECT command_id, source_kind, source_registration_transaction_id, snapshot_json
         FROM customer_saved_configurations
         WHERE id = '${savedResult.id}'`,
      ),
    ).toEqual([
      {
        command_id: saveCommandId,
        snapshot_json: snapshot,
        source_kind: "explicit",
        source_registration_transaction_id: null,
      },
    ]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_saved_configurations
         WHERE command_id = '${saveCommandId}'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM anonymous_quote_lines",
      ),
    ).toEqual(quoteLinesBefore);

    const accountPage = await fetch(
      `${origin}/account?view=saved-configurations`,
      { headers: { cookie: ownerCookie } },
    );
    const accountHtml = renderedText(await accountPage.text());
    expect(accountPage.status).toBe(200);
    expect(accountHtml).toContain("601R1 Hydraulic Hose");
    expect(accountHtml).toContain("Saved configuration");
    expect(accountHtml).toContain("Resume");

    const resumed = await fetch(
      `${origin}/build-a-hose?savedConfiguration=${savedResult.id}`,
      { headers: { cookie: ownerCookie } },
    );
    const resumedHtml = renderedText(await resumed.text());
    expect(resumed.status).toBe(200);
    expect(resumedHtml).toContain("Resumed saved configuration");
    expect(resumedHtml).toContain("isolated working copy");
    expect(resumedHtml).toContain("601R1_001");
    expect(resumedHtml).toContain("Configuration needs attention");
    expect(
      runLocalD1<{ snapshot_json: string }>(
        `SELECT snapshot_json FROM customer_saved_configurations
         WHERE id = '${savedResult.id}'`,
      ),
    ).toEqual([{ snapshot_json: snapshot }]);

    const foreignResume = await fetch(
      `${origin}/build-a-hose?savedConfiguration=${savedResult.id}`,
      { headers: { cookie: otherCookie } },
    );
    expect(renderedText(await foreignResume.text())).toContain(
      "unavailable or does not belong to this account",
    );
    expect((await deleteSaved(otherCookie, savedResult.id)).status).toBe(404);
    expect((await deleteSaved(ownerCookie, savedResult.id)).status).toBe(302);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_saved_configurations
         WHERE id = '${savedResult.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
  }, 180_000);

  it("supports optional password setup, both sign-in methods, change and single-use OTP reset", async () => {
    const email = "password.customer@example.com";
    const initialPassword = "Launch customer passphrase 2026";
    const changedPassword = "Changed customer passphrase 2026";
    const otpChangedPassword = "Email changed customer passphrase 2026";
    const resetPassword = "Reset customer passphrase 2026";

    const registration = await requestEmailOtp({ email, path: "/register" });
    if (!registration.challenge) throw new Error("Expected registration code");
    const registrationVerified = await verifyEmailOtp({
      challengeId: registration.challenge.challengeId,
      code: registration.challenge.code,
      path: "/register",
    });
    expect(registrationVerified.status).toBe(302);
    const registrationCookie = cookieHeader(registrationVerified);
    const [originalProfile] = runLocalD1<{ id: string }>(
      `SELECT id FROM customer_profiles WHERE email_normalized = '${email}'`,
    );
    expect(originalProfile?.id).toBeTruthy();
    const securityPage = await fetch(`${origin}/account/security?welcome=1`, {
      headers: { cookie: registrationCookie },
    });
    const securityHtml = await securityPage.text();
    expect(securityHtml).toContain("Set password");
    expect(securityHtml).toContain("Skip for now");

    const setPassword = new FormData();
    setPassword.set("intent", "set");
    setPassword.set("newPassword", initialPassword);
    setPassword.set("confirmPassword", initialPassword);
    const setResponse = await fetch(`${origin}/account/security`, {
      body: setPassword,
      headers: { cookie: registrationCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(setResponse.status).toBe(302);
    const [storedCredential] = runLocalD1<{
      algorithm: string;
      credential_version: number;
      derived_key: string;
      hash_bytes: number;
      normalization: string;
      salt: string;
      work_factor: number;
    }>(
      `SELECT algorithm, credential_version, derived_key, hash_bytes,
              normalization, salt, work_factor
       FROM customer_password_credentials c
       INNER JOIN customer_profiles p ON p.id = c.profile_id
       WHERE p.email_normalized = '${email}'`,
    );
    expect(storedCredential).toMatchObject({
      algorithm: "PBKDF2-HMAC-SHA-256",
      credential_version: 1,
      hash_bytes: 32,
      normalization: "NFC",
      work_factor: 600000,
    });
    expect(JSON.stringify(storedCredential)).not.toContain(initialPassword);
    expect(storedCredential?.salt).toBeTruthy();

    const signOut = await fetch(`${origin}/sign-out`, {
      headers: { cookie: registrationCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(signOut.status).toBe(302);

    async function passwordSignIn(password: string, signInEmail = email) {
      const form = new FormData();
      form.set("intent", "password");
      form.set("email", signInEmail);
      form.set("password", password);
      form.set("returnTo", "/account");
      return fetch(`${origin}/sign-in?method=password&returnTo=%2Faccount`, {
        body: form,
        headers: { origin },
        method: "POST",
        redirect: "manual",
      });
    }

    const signedIn = await passwordSignIn(initialPassword);
    expect(signedIn.status).toBe(302);
    expect(signedIn.headers.get("location")).toBe("/account");
    const passwordCookie = cookieHeader(signedIn);
    const wrongExisting = await passwordSignIn("Wrong customer passphrase");
    const wrongUnknown = await passwordSignIn(
      "Wrong customer passphrase",
      "not-an-account@example.com",
    );
    expect(wrongExisting.status).toBe(422);
    expect(wrongUnknown.status).toBe(422);
    expect(renderedText(await wrongExisting.text())).toContain(
      "The email or password is incorrect.",
    );
    expect(renderedText(await wrongUnknown.text())).toContain(
      "The email or password is incorrect.",
    );

    const hostileChange = new FormData();
    hostileChange.set("intent", "change-current");
    hostileChange.set("currentPassword", initialPassword);
    hostileChange.set("newPassword", changedPassword);
    hostileChange.set("confirmPassword", changedPassword);
    expect([400, 403]).toContain(
      (
        await fetch(`${origin}/account/security`, {
          body: hostileChange,
          headers: {
            cookie: passwordCookie,
            origin: "https://evil.example",
          },
          method: "POST",
        })
      ).status,
    );

    const rejectedNewPassword = new FormData();
    rejectedNewPassword.set("intent", "change-current");
    rejectedNewPassword.set("currentPassword", initialPassword);
    rejectedNewPassword.set("newPassword", "too short");
    rejectedNewPassword.set("confirmPassword", "too short");
    expect(
      (
        await fetch(`${origin}/account/security`, {
          body: rejectedNewPassword,
          headers: { cookie: passwordCookie, origin },
          method: "POST",
        })
      ).status,
    ).toBe(422);
    expect(
      runLocalD1<{ attempt_kind: string; succeeded_at: string | null }>(
        `SELECT attempt_kind, succeeded_at FROM customer_password_attempts
         WHERE attempt_kind = 'password_change'
         ORDER BY rowid DESC LIMIT 1`,
      )[0],
    ).toMatchObject({
      attempt_kind: "password_change",
      succeeded_at: expect.any(String),
    });

    const change = new FormData();
    change.set("intent", "change-current");
    change.set("currentPassword", initialPassword);
    change.set("newPassword", changedPassword);
    change.set("confirmPassword", changedPassword);
    const changed = await fetch(`${origin}/account/security`, {
      body: change,
      headers: { cookie: passwordCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(changed.status).toBe(302);
    const changedCookie = cookieHeader(changed);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: passwordCookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    expect((await passwordSignIn(initialPassword)).status).toBe(422);
    expect((await passwordSignIn(changedPassword)).status).toBe(302);

    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE email_normalized = '${email}'`,
    );
    const requestChangeCode = new FormData();
    requestChangeCode.set("intent", "request-code");
    const changeCodeResponse = await fetch(`${origin}/account/security`, {
      body: requestChangeCode,
      headers: { cookie: changedCookie, origin },
      method: "POST",
    });
    const changeCodeHtml = await changeCodeResponse.text();
    expect(changeCodeResponse.status).toBe(200);
    const changeCode = otpChallengeFromHtml(changeCodeHtml);
    const verifyChangeCode = new FormData();
    verifyChangeCode.set("intent", "verify-code");
    verifyChangeCode.set("challengeId", changeCode.challengeId);
    verifyChangeCode.set("code", changeCode.code);
    const changeCodeVerified = await fetch(`${origin}/account/security`, {
      body: verifyChangeCode,
      headers: { cookie: changedCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(changeCodeVerified.status).toBe(302);
    expect(changeCodeVerified.headers.get("location")).toBe(
      "/reset-password?mode=change",
    );
    const changeAuthorizationCookie = cookieHeader(changeCodeVerified);
    const otpChangeForm = new FormData();
    otpChangeForm.set("newPassword", otpChangedPassword);
    otpChangeForm.set("confirmPassword", otpChangedPassword);
    const otpChanged = await fetch(`${origin}/reset-password?mode=change`, {
      body: otpChangeForm,
      headers: { cookie: changeAuthorizationCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(otpChanged.status).toBe(302);
    const otpChangedCookie = cookieHeader(otpChanged);
    expect((await passwordSignIn(changedPassword)).status).toBe(422);
    expect((await passwordSignIn(otpChangedPassword)).status).toBe(302);

    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE email_normalized = '${email}'`,
    );
    const resetRequest = await requestEmailOtp({
      email,
      path: "/forgot-password",
    });
    if (!resetRequest.challenge) throw new Error("Expected reset code");
    expect(
      runLocalD1<{ authorization_scope: string }>(
        `SELECT authorization_scope FROM customer_otp_challenges
         WHERE id = '${resetRequest.challenge.challengeId}'`,
      ),
    ).toEqual([{ authorization_scope: "password_reset" }]);
    const resetVerified = await verifyEmailOtp({
      challengeId: resetRequest.challenge.challengeId,
      code: resetRequest.challenge.code,
      path: "/forgot-password",
    });
    expect(resetVerified.status).toBe(302);
    expect(resetVerified.headers.get("location")).toBe("/reset-password");
    const resetAuthorizationCookie = cookieHeader(resetVerified);
    function resetPasswordForm() {
      const form = new FormData();
      form.set("newPassword", resetPassword);
      form.set("confirmPassword", resetPassword);
      return form;
    }
    expect([400, 403]).toContain(
      (
        await fetch(`${origin}/reset-password`, {
          body: resetPasswordForm(),
          headers: {
            cookie: resetAuthorizationCookie,
            origin: "https://evil.example",
          },
          method: "POST",
        })
      ).status,
    );
    const competingResets = await Promise.all(
      Array.from({ length: 2 }, () =>
        fetch(`${origin}/reset-password`, {
          body: resetPasswordForm(),
          headers: { cookie: resetAuthorizationCookie, origin },
          method: "POST",
          redirect: "manual",
        }),
      ),
    );
    const successfulResets = competingResets.filter(
      (response) =>
        response.headers.get("location") === "/account/security?saved=1",
    );
    expect(successfulResets).toHaveLength(1);
    const reset = successfulResets[0];
    if (!reset) throw new Error("Expected one successful password reset");
    expect(reset.status).toBe(302);
    const resetSessionCookie = cookieHeader(reset);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: otpChangedCookie },
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: resetSessionCookie },
        })
      ).status,
    ).toBe(200);
    expect((await passwordSignIn(otpChangedPassword)).status).toBe(422);
    expect((await passwordSignIn(resetPassword)).status).toBe(302);

    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE email_normalized = '${email}'`,
    );
    const limitedResetRequest = await requestEmailOtp({
      email,
      path: "/forgot-password",
    });
    if (!limitedResetRequest.challenge) {
      throw new Error("Expected rate-limit reset code");
    }
    const limitedResetVerified = await verifyEmailOtp({
      challengeId: limitedResetRequest.challenge.challengeId,
      code: limitedResetRequest.challenge.code,
      path: "/forgot-password",
    });
    const limitedResetCookie = cookieHeader(limitedResetVerified);
    const [resetAttempt] = runLocalD1<{
      email_digest: string;
      request_ip_digest: string;
    }>(
      `SELECT email_digest, request_ip_digest FROM customer_password_attempts
       WHERE attempt_kind = 'password_reset' LIMIT 1`,
    );
    if (!resetAttempt) throw new Error("Expected a reset attempt digest");
    runLocalD1(
      `DELETE FROM customer_password_attempts
       WHERE attempt_kind = 'password_reset'`,
    );
    runLocalD1(
      `WITH RECURSIVE attempts(number) AS (
         SELECT 1 UNION ALL SELECT number + 1 FROM attempts WHERE number < 10
       )
       INSERT INTO customer_password_attempts
       (id, attempt_kind, email_digest, request_ip_digest, created_at)
       SELECT 'reset-limit-' || number, 'password_reset',
              '${resetAttempt.email_digest}',
              '${resetAttempt.request_ip_digest}',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       FROM attempts`,
    );
    expect(
      (
        await fetch(`${origin}/reset-password`, {
          body: resetPasswordForm(),
          headers: { cookie: limitedResetCookie, origin },
          method: "POST",
        })
      ).status,
    ).toBe(429);

    const replay = await fetch(`${origin}/reset-password`, {
      body: resetPasswordForm(),
      headers: { cookie: resetAuthorizationCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toBe("/forgot-password");
    expect(
      runLocalD1<{ credential_version: number }>(
        `SELECT c.credential_version FROM customer_password_credentials c
         INNER JOIN customer_profiles p ON p.id = c.profile_id
         WHERE p.email_normalized = '${email}'`,
      ),
    ).toEqual([{ credential_version: 4 }]);

    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE email_normalized = '${email}'`,
    );
    const otpSignIn = await requestEmailOtp({ email, path: "/sign-in" });
    if (!otpSignIn.challenge) throw new Error("Expected OTP sign-in code");
    expect(
      (
        await verifyEmailOtp({
          challengeId: otpSignIn.challenge.challengeId,
          code: otpSignIn.challenge.code,
          path: "/sign-in",
        })
      ).status,
    ).toBe(302);

    const skippedEmail = "password-skipped@example.com";
    const skippedRegistration = await requestEmailOtp({
      email: skippedEmail,
      path: "/register",
    });
    if (!skippedRegistration.challenge) {
      throw new Error("Expected optional-password registration code");
    }
    const skippedVerified = await verifyEmailOtp({
      challengeId: skippedRegistration.challenge.challengeId,
      code: skippedRegistration.challenge.code,
      path: "/register",
    });
    const skippedCookie = cookieHeader(skippedVerified);
    expect(
      (
        await fetch(`${origin}/account`, {
          headers: { cookie: skippedCookie },
        })
      ).status,
    ).toBe(200);
    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
       WHERE email_normalized = '${skippedEmail}'`,
    );
    const skippedOtpSignIn = await requestEmailOtp({
      email: skippedEmail,
      path: "/sign-in",
    });
    if (!skippedOtpSignIn.challenge) {
      throw new Error("Expected OTP sign-in after skipping password");
    }
    const skippedOtpVerified = await verifyEmailOtp({
      challengeId: skippedOtpSignIn.challenge.challengeId,
      code: skippedOtpSignIn.challenge.code,
      path: "/sign-in",
    });
    expect(skippedOtpVerified.status).toBe(302);
    const skippedOtpCookie = cookieHeader(skippedOtpVerified);
    const addLaterForm = new FormData();
    addLaterForm.set("intent", "set");
    addLaterForm.set("newPassword", "Added later customer passphrase 2026");
    addLaterForm.set("confirmPassword", "Added later customer passphrase 2026");
    expect(
      (
        await fetch(`${origin}/account/security`, {
          body: addLaterForm,
          headers: { cookie: skippedOtpCookie, origin },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const limitedPasswordEmail = "password-rate-limit@example.com";
    const passwordLimitStatuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      passwordLimitStatuses.push(
        (
          await passwordSignIn(
            "Always wrong customer passphrase",
            limitedPasswordEmail,
          )
        ).status,
      );
    }
    expect(passwordLimitStatuses.slice(0, 10)).toEqual(Array(10).fill(422));
    expect(passwordLimitStatuses[10]).toBe(429);

    const [changeAttempt] = runLocalD1<{
      email_digest: string;
      request_ip_digest: string;
    }>(
      `SELECT email_digest, request_ip_digest FROM customer_password_attempts
       WHERE attempt_kind = 'password_change' LIMIT 1`,
    );
    if (!changeAttempt) throw new Error("Expected a password-change attempt");
    runLocalD1(
      `DELETE FROM customer_password_attempts
       WHERE attempt_kind = 'password_change'`,
    );
    runLocalD1(
      `WITH RECURSIVE attempts(number) AS (
         SELECT 1 UNION ALL SELECT number + 1 FROM attempts WHERE number < 10
       )
       INSERT INTO customer_password_attempts
       (id, attempt_kind, email_digest, request_ip_digest, created_at)
       SELECT 'change-limit-' || number, 'password_change',
              '${changeAttempt.email_digest}',
              '${changeAttempt.request_ip_digest}',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       FROM attempts`,
    );
    const limitedChange = new FormData();
    limitedChange.set("intent", "change-current");
    limitedChange.set("currentPassword", resetPassword);
    limitedChange.set("newPassword", "Rate limited replacement passphrase");
    limitedChange.set("confirmPassword", "Rate limited replacement passphrase");
    expect(
      (
        await fetch(`${origin}/account/security`, {
          body: limitedChange,
          headers: { cookie: resetSessionCookie, origin },
          method: "POST",
        })
      ).status,
    ).toBe(429);

    expect(
      runLocalD1<{ id: string }>(
        `SELECT id FROM customer_profiles WHERE email_normalized = '${email}'`,
      ),
    ).toEqual([{ id: originalProfile?.id ?? "" }]);

    const csrfForm = new FormData();
    csrfForm.set("intent", "password");
    csrfForm.set("email", email);
    csrfForm.set("password", resetPassword);
    expect([400, 403]).toContain(
      (
        await fetch(`${origin}/sign-in?method=password`, {
          body: csrfForm,
          headers: { origin: "https://evil.example" },
          method: "POST",
        })
      ).status,
    );
  }, 120_000);

  it("fails closed for cooldown, supersession, expiry, malformed values and attempt lockout", async () => {
    const locked = await requestEmailOtp({
      email: "locked.customer@example.com",
      path: "/register",
    });
    const lockedChallenge = locked.challenge;
    if (!lockedChallenge) throw new Error("Expected a lockout challenge");
    const cooldown = await requestEmailOtp({
      email: "locked.customer@example.com",
      path: "/register",
    });
    expect(cooldown.response.status).toBe(429);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await verifyEmailOtp({
        challengeId: lockedChallenge.challengeId,
        code: "999999",
        path: "/register",
      });
      expect(failed.status).toBe(422);
    }
    const afterLock = await verifyEmailOtp({
      challengeId: lockedChallenge.challengeId,
      code: lockedChallenge.code,
      path: "/register",
    });
    expect(afterLock.status).toBe(422);
    expect(
      runLocalD1<{ failed_attempts: number }>(
        `SELECT failed_attempts FROM customer_otp_challenges WHERE id = '${lockedChallenge.challengeId}'`,
      ),
    ).toEqual([{ failed_attempts: 5 }]);

    const expired = await requestEmailOtp({
      email: "expired.customer@example.com",
      path: "/register",
    });
    if (!expired.challenge) throw new Error("Expected an expiry challenge");
    runLocalD1(
      `UPDATE customer_otp_challenges SET expires_at = '2000-01-01T00:00:00.000Z'
       WHERE id = '${expired.challenge.challengeId}'`,
    );
    expect(
      (
        await verifyEmailOtp({
          challengeId: expired.challenge.challengeId,
          code: expired.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);

    const first = await requestEmailOtp({
      email: "superseded.customer@example.com",
      path: "/register",
    });
    if (!first.challenge) throw new Error("Expected a superseded challenge");
    runLocalD1(
      `UPDATE customer_otp_challenges
       SET created_at = datetime('now', '-61 seconds')
       WHERE id = '${first.challenge.challengeId}'`,
    );
    const second = await requestEmailOtp({
      email: "superseded.customer@example.com",
      path: "/register",
    });
    expect(second.response.status).toBe(200);
    expect(
      (
        await verifyEmailOtp({
          challengeId: first.challenge.challengeId,
          code: first.challenge.code,
          path: "/register",
        })
      ).status,
    ).toBe(422);

    expect(
      (
        await verifyEmailOtp({
          challengeId: second.challenge?.challengeId ?? "",
          code: "123",
          path: "/register",
        })
      ).status,
    ).toBe(422);
    const wrongOrigin = new FormData();
    wrongOrigin.set("intent", "request");
    wrongOrigin.set("email", "csrf.customer@example.com");
    const rejectedOrigin = await fetch(`${origin}/register`, {
      body: wrongOrigin,
      headers: { origin: "https://evil.example" },
      method: "POST",
    });
    expect([400, 403]).toContain(rejectedOrigin.status);

    const concurrentEmail = "concurrent.customer@example.com";
    const concurrent = await Promise.all([
      requestEmailOtp({ email: concurrentEmail, path: "/register" }),
      requestEmailOtp({ email: concurrentEmail, path: "/register" }),
    ]);
    expect(concurrent.map(({ response }) => response.status).sort()).toEqual([
      200, 429,
    ]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_otp_challenges
         WHERE email_normalized = '${concurrentEmail}'`,
      ),
    ).toEqual([{ count: 1 }]);

    const limitedEmail = "limited.customer@example.com";
    for (let requestNumber = 0; requestNumber < 4; requestNumber += 1) {
      const limited = await requestEmailOtp({
        email: limitedEmail,
        path: "/register",
      });
      expect(limited.response.status).toBe(200);
      runLocalD1(
        `UPDATE customer_otp_challenges
         SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-61 seconds')
         WHERE id = '${limited.challenge?.challengeId ?? ""}'`,
      );
    }
    const emailBoundary = await Promise.all([
      requestEmailOtp({ email: limitedEmail, path: "/register" }),
      requestEmailOtp({ email: limitedEmail, path: "/register" }),
    ]);
    expect(emailBoundary.map(({ response }) => response.status).sort()).toEqual(
      [200, 429],
    );
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_otp_challenges
         WHERE email_normalized = '${limitedEmail}'`,
      ),
    ).toEqual([{ count: 5 }]);

    const sharedIp = "198.51.100.35";
    for (let requestNumber = 0; requestNumber < 19; requestNumber += 1) {
      const requestedByIp = await requestEmailOtp({
        email: `ip-limit-${requestNumber}@example.com`,
        ip: sharedIp,
        path: "/register",
      });
      expect(requestedByIp.response.status).toBe(200);
    }
    const ipBoundary = await Promise.all([
      requestEmailOtp({
        email: "ip-limit-boundary-a@example.com",
        ip: sharedIp,
        path: "/register",
      }),
      requestEmailOtp({
        email: "ip-limit-boundary-b@example.com",
        ip: sharedIp,
        path: "/register",
      }),
    ]);
    expect(ipBoundary.map(({ response }) => response.status).sort()).toEqual([
      200, 429,
    ]);
    expect(ipBoundary.map(({ html }) => html).join(" ")).toContain(
      "Too many verification requests",
    );

    const racing = await requestEmailOtp({
      email: "racing.customer@example.com",
      path: "/register",
    });
    if (!racing.challenge) throw new Error("Expected a race challenge");
    runLocalD1(
      `UPDATE customer_otp_challenges SET failed_attempts = 4
       WHERE id = '${racing.challenge.challengeId}'`,
    );
    const [fifthFailure, correctAtBoundary] = await Promise.all([
      verifyEmailOtp({
        challengeId: racing.challenge.challengeId,
        code: "999999",
        path: "/register",
      }),
      verifyEmailOtp({
        challengeId: racing.challenge.challengeId,
        code: racing.challenge.code,
        path: "/register",
      }),
    ]);
    expect(fifthFailure.status).toBe(422);
    expect([302, 422]).toContain(correctAtBoundary.status);
    const [raceState] = runLocalD1<{
      consumed_at: string | null;
      failed_attempts: number;
    }>(
      `SELECT consumed_at, failed_attempts FROM customer_otp_challenges
       WHERE id = '${racing.challenge.challengeId}'`,
    );
    if (correctAtBoundary.status === 302) {
      expect(raceState?.consumed_at).not.toBeNull();
      expect(raceState?.failed_attempts).toBe(4);
    } else {
      expect(raceState).toMatchObject({
        consumed_at: null,
        failed_attempts: 5,
      });
    }

    const unknown = await requestEmailOtp({
      email: "unknown.customer@example.com",
      path: "/sign-in",
    });
    expect(unknown.response.status).toBe(200);
    expect(unknown.html).toContain("We sent a six-digit code");
    expect(
      (
        await verifyEmailOtp({
          challengeId: unknown.challenge?.challengeId ?? "",
          code: unknown.challenge?.code ?? "",
          path: "/sign-in",
        })
      ).status,
    ).toBe(422);
    expect(
      runLocalD1<{ count: number }>(
        "SELECT COUNT(*) AS count FROM customer_profiles WHERE email_normalized = 'unknown.customer@example.com'",
      ),
    ).toEqual([{ count: 0 }]);
  });

  it("persists a draft release through the Admin diagnostic and exposes no Storefront mutation", async () => {
    const createResponse = await fetch(
      `${origin}/admin/diagnostics/catalog-release`,
      {
        method: "POST",
        redirect: "manual",
      },
    );
    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.get("location")).toMatch(
      /^\/admin\/diagnostics\/catalog-release\?created=/,
    );

    const diagnosticResponse = await fetch(
      `${origin}${createResponse.headers.get("location")}`,
    );
    expect(diagnosticResponse.status).toBe(200);
    const diagnostic = await diagnosticResponse.text();
    expect(diagnostic).toContain("Catalog release diagnostic");
    expect(diagnostic).toContain("Draft");
    expect(diagnostic).toContain("Not published");

    const storefrontMutation = await fetch(origin, { method: "POST" });
    expect(storefrontMutation.status).toBe(405);
  });

  it("imports the supplied 01-07 workbook into one reviewable D1 draft", async () => {
    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const form = new FormData();
    form.set(
      "workbook",
      new File([workbook], "hose-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    expect(importResponse.headers.get("location")).toMatch(
      /^\/admin\/catalog\/import\?import=/,
    );
    const importId = new URL(
      importResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    expect(importId).toBeTruthy();

    const reviewResponse = await fetch(
      `${origin}${importResponse.headers.get("location")}`,
    );
    expect(reviewResponse.status).toBe(200);
    const review = await reviewResponse.text();
    expect(review).toContain("Draft release created");
    expect(review).toContain("Hose variants");
    expect(review).toContain(">61<");
    expect(review).toContain("Hose ends");
    expect(review).toContain(">329<");
    expect(review).toContain("Exact combinations");
    expect(review).toContain(">1210<");
    expect(review).toContain("Adapter families");
    expect(review).toContain(">17<");
    expect(review).toContain("Adapter SKUs");
    expect(review).toContain(">136<");
    expect(review).toContain("Quick couplers");
    expect(review).toContain(">57<");
    expect(review).toContain("Sales offers");
    expect(review).toContain("USD reference prices");
    expect(review).toContain("Total sale SKUs");
    expect(review).toContain(">644<");
    expect(review).toContain("All imported SKUs start Temporarily Unavailable");
    expect(review).toContain("only Approved + Complete");

    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_adapters WHERE import_id = '${importId}'`,
      ),
    ).toEqual([{ count: 136 }]);
    expect(
      runLocalD1<{
        connection_form_1: string;
        connection_form_2: string;
        interface_1: string;
        interface_2: string;
        shape_code: string;
        size_1: string;
        size_2: string;
      }>(
        `SELECT shape_code, interface_1, connection_form_1, size_1,
                interface_2, connection_form_2, size_2
         FROM catalog_adapters
         WHERE import_id = '${importId}' AND sku = 'ADP_ST_JIC_M_10_NPT_M_04'`,
      ),
    ).toEqual([
      {
        connection_form_1: "M",
        connection_form_2: "M",
        interface_1: "JIC",
        interface_2: "NPT",
        shape_code: "ST",
        size_1: "-10",
        size_2: "-4",
      },
    ]);
    expect(
      runLocalD1<{
        body_dash: string;
        max_working_bar: number | null;
        port_code: string;
        port_dash: string;
        role: string;
        sku_standard_code: string;
      }>(
        `SELECT sku_standard_code, role, body_dash, port_code, port_dash, max_working_bar
         FROM catalog_quick_couplers
         WHERE import_id = '${importId}' AND sku = 'QDC_16028_SOC_04_FNPT_04'`,
      ),
    ).toEqual([
      {
        body_dash: "04",
        max_working_bar: null,
        port_code: "FNPT",
        port_dash: "04",
        role: "Coupler/Socket",
        sku_standard_code: "16028",
      },
    ]);
    expect(
      runLocalD1<{ currency: string; reference_price_usd: number }>(
        `SELECT currency, reference_price_usd FROM catalog_sales_offers
         WHERE import_id = '${importId}' AND sales_sku = '601R1_001'`,
      ),
    ).toEqual([{ currency: "USD", reference_price_usd: 2.16 }]);
    expect(
      runLocalD1<{ name: string }>("PRAGMA table_info(catalog_sales_offers)")
        .map((column) => column.name)
        .includes("factory_unit_price"),
    ).toBe(false);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_cost_bases
         WHERE import_id = '${importId}' AND factory_unit_price IS NOT NULL`,
      ),
    ).toEqual([{ count: 0 }]);

    const storefront = await (await fetch(origin)).text();
    expect(storefront).not.toContain("Cost Basis");
    expect(storefront).not.toContain("factory_unit_price");
    const publicCostBasis = await fetch(
      `${origin}/api/catalog/cost-basis/601R1_001`,
    );
    expect(publicCostBasis.status).toBe(404);
  });

  it("maintains versioned configurator registries only on a draft release", async () => {
    const [draft] = runLocalD1<{ id: string }>(
      `SELECT catalog_releases.id
       FROM catalog_releases
       INNER JOIN catalog_imports
         ON catalog_imports.id = catalog_releases.source_import_id
       WHERE catalog_releases.status = 'draft'
         AND catalog_imports.kind = 'workbook'
         AND catalog_imports.status = 'completed'
       ORDER BY catalog_releases.created_at DESC LIMIT 1`,
    );
    expect(draft).toBeTruthy();
    if (!draft) throw new Error("Expected one imported workbook draft");

    const pageResponse = await fetch(
      `${origin}/admin/catalog/reference-data?release=${draft.id}`,
    );
    const page = await pageResponse.text();
    expect(pageResponse.status).toBe(200);
    expect(page).toContain("Configurator Registries");
    expect(page).toContain("Measurement Methods");
    expect(page).toContain("Clocking Convention");
    expect(page).toContain("Installed Protection");
    expect(page).toContain("Assembly Estimate Schedule");
    expect(page).toContain("No additional installed protection");
    expect(page).toContain("View customer measurement guide");
    expect(page).not.toContain("Hose End assignments");

    const guideResponse = await fetch(`${origin}/assembly-measurement-guide`);
    const guide = await guideResponse.text();
    expect(guideResponse.status).toBe(200);
    expect(guide).toContain("Hose Assembly Measurement Guide");
    expect(guide).toContain("Identify each measurement endpoint");
    for (const method of [
      "M01",
      "M02",
      "M03",
      "M04",
      "M05",
      "M06",
      "M07",
      "M08",
    ]) {
      expect(guide).toContain(method);
    }
    expect(guide).toContain("View the assembly from End A toward End B");
    expect(guide).toContain("Clocking angle");
    expect(guide).toContain("Enter any whole degree from 000 to 359");
    expect(guide).toContain('type="range"');
    expect(guide).toContain("Not sure");

    const replaceMapping = new FormData();
    replaceMapping.set("intent", "save_measurement_mapping");
    replaceMapping.set("releaseId", draft.id);
    replaceMapping.set("endAClassCode", "STRAIGHT_MALE_END");
    replaceMapping.set("endBClassCode", "STRAIGHT_MALE_END");
    replaceMapping.set("guidanceStatus", "guided");
    replaceMapping.set("methodCode", "M02");
    const replaceMappingResponse = await fetch(
      `${origin}/admin/catalog/reference-data`,
      { body: replaceMapping, method: "POST", redirect: "manual" },
    );
    expect(replaceMappingResponse.status).toBe(302);
    expect(
      runLocalD1<{ count: number; method_code: string }>(
        `SELECT COUNT(*) AS count,
                json_extract(payload_json, '$.methodCode') AS method_code
         FROM catalog_configurator_registry_entries
         WHERE release_id = '${draft.id}'
           AND registry_type = 'measurement_mapping'
           AND entry_key = 'STRAIGHT_MALE_END:STRAIGHT_MALE_END'`,
      ),
    ).toEqual([{ count: 1, method_code: "M02" }]);
    replaceMapping.set("methodCode", "M01");
    const restoreMappingResponse = await fetch(
      `${origin}/admin/catalog/reference-data`,
      { body: replaceMapping, method: "POST", redirect: "manual" },
    );
    expect(restoreMappingResponse.status).toBe(302);

    const [before] = runLocalD1<{
      record_version: number;
      release_version: number;
    }>(
      `SELECT entry.record_version, release.version AS release_version
       FROM catalog_configurator_registry_entries entry
       INNER JOIN catalog_releases release ON release.id = entry.release_id
       WHERE entry.release_id = '${draft.id}'
         AND entry.registry_type = 'assembly_estimate_schedule'
         AND entry.entry_key = 'DEFAULT'`,
    );
    expect(before).toBeTruthy();

    const saveSchedule = new FormData();
    saveSchedule.set("intent", "save_estimate_schedule");
    saveSchedule.set("releaseId", draft.id);
    saveSchedule.set("assemblyServicePriceUsd", "");
    const saveResponse = await fetch(`${origin}/admin/catalog/reference-data`, {
      body: saveSchedule,
      method: "POST",
      redirect: "manual",
    });
    expect(saveResponse.status, await saveResponse.text()).toBe(302);
    expect(saveResponse.headers.get("location")).toContain(
      "saved=assembly_estimate_schedule",
    );

    const [after] = runLocalD1<{
      record_version: number;
      release_version: number;
    }>(
      `SELECT entry.record_version, release.version AS release_version
       FROM catalog_configurator_registry_entries entry
       INNER JOIN catalog_releases release ON release.id = entry.release_id
       WHERE entry.release_id = '${draft.id}'
         AND entry.registry_type = 'assembly_estimate_schedule'
         AND entry.entry_key = 'DEFAULT'`,
    );
    expect(after?.record_version).toBe((before?.record_version ?? 0) + 1);
    expect(after?.release_version).toBe((before?.release_version ?? 0) + 1);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM admin_audit_events
         WHERE entity_id = '${draft.id}:assembly_estimate_schedule:DEFAULT'
           AND event_type = 'configurator_registry.saved'`,
      )[0]?.count,
    ).toBeGreaterThan(0);

    const invalidMapping = new FormData();
    invalidMapping.set("intent", "save_measurement_mapping");
    invalidMapping.set("releaseId", draft.id);
    invalidMapping.set("endAClassCode", "NOT_REGISTERED");
    invalidMapping.set("endBClassCode", "STRAIGHT_MALE_END");
    invalidMapping.set("guidanceStatus", "guided");
    invalidMapping.set("methodCode", "M01");
    const invalidResponse = await fetch(
      `${origin}/admin/catalog/reference-data`,
      { body: invalidMapping, method: "POST" },
    );
    expect(invalidResponse.status).toBe(200);
    expect(await invalidResponse.text()).toContain(
      "Measurement Endpoint Class NOT_REGISTERED is missing",
    );

    runLocalD1(
      `DELETE FROM catalog_configurator_registry_entries
       WHERE release_id = '${draft.id}'
         AND registry_type = 'measurement_method'
         AND entry_key = 'M07'`,
    );
    const invalidPreview = await (
      await fetch(`${origin}/admin/catalog/releases?release=${draft.id}`)
    ).text();
    expect(invalidPreview).toContain("Configurator registry is missing M07");
    runLocalD1(
      `INSERT INTO catalog_configurator_registry_entries (
         release_id, registry_type, entry_key, payload_json,
         record_version, updated_at
       )
       SELECT '${draft.id}', registry_type, entry_key, payload_json, 1,
              CURRENT_TIMESTAMP
       FROM configurator_registry_seed_templates
       WHERE registry_type = 'measurement_method' AND entry_key = 'M07'`,
    );
  });

  it("reviews and changes only draft Supply Availability through confirmation", async () => {
    const [draft] = runLocalD1<{
      id: string;
      source_import_id: string;
    }>(
      `SELECT catalog_releases.id, catalog_releases.source_import_id
       FROM catalog_releases
       INNER JOIN catalog_imports
         ON catalog_imports.id = catalog_releases.source_import_id
       WHERE catalog_releases.status = 'draft'
         AND catalog_imports.kind = 'workbook'
         AND catalog_imports.status = 'completed'
       ORDER BY catalog_releases.created_at DESC LIMIT 1`,
    );
    expect(draft).toBeTruthy();
    if (!draft) throw new Error("Expected one imported workbook draft");

    runLocalD1(
      `UPDATE catalog_cost_bases SET factory_unit_price = 1.11
       WHERE import_id = '${draft.source_import_id}' AND sales_sku = '601R1_001'`,
    );
    const reviewResponse = await fetch(
      `${origin}/admin/catalog/review?release=${draft.id}&sku=601R1_001`,
    );
    const review = await reviewResponse.text();
    expect(reviewResponse.status).toBe(200);
    expect(review).toContain("Review draft products");
    expect(review).toContain("601R1_001");
    expect(review).toContain("Cost Basis");
    expect(review).toContain("USD 1.11");

    const activeImportId = `availability-active-import-${crypto.randomUUID()}`;
    const activeReleaseId = `availability-active-release-${crypto.randomUUID()}`;
    const activeSkuId = `availability-active-sku-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    runLocalD1(
      `UPDATE catalog_releases SET status = 'superseded' WHERE status = 'published';
       INSERT INTO catalog_imports (
         id, kind, status, summary_json, error_count, warning_count,
         created_at, completed_at
       ) VALUES (
         '${activeImportId}', 'workbook', 'completed', '{}', 0, 0, '${now}', '${now}'
       );
       INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         '${activeSkuId}', '${activeImportId}', '601R1_001', '01_胶管主数据',
         'hose', '601R1', 'Published', 'Eligible', 'Complete',
         'temporarily_unavailable'
       );
       INSERT INTO catalog_releases (
         id, release_number, status, source_import_id, version, created_at, published_at
       ) VALUES (
         '${activeReleaseId}', 'ACTIVE-${activeReleaseId}', 'published',
         '${activeImportId}', 1, '${now}', '${now}'
       );
       UPDATE catalog_active_release
       SET release_id = '${activeReleaseId}', version = version + 1, updated_at = '${now}'
       WHERE singleton = 1;`,
    );

    const auditBefore = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM admin_audit_events
       WHERE entity_id = '${draft.id}'
         AND event_type = 'catalog_release.supply_availability_bulk_changed'`,
    )[0]?.count;

    const previewSelected = new FormData();
    previewSelected.set("intent", "preview");
    previewSelected.set("releaseId", draft.id);
    previewSelected.set("selectorMode", "selected");
    previewSelected.set("selectedSku", "601R1_001");
    previewSelected.set("target", "available_for_quote");
    const previewResponse = await fetch(`${origin}/admin/catalog/review`, {
      body: previewSelected,
      method: "POST",
    });
    const preview = await previewResponse.text();
    expect(previewResponse.status).toBe(200);
    expect(preview).toContain("Confirm bulk change");
    expect(preview).toContain('data-affected-count="1"');
    expect(preview).toContain('data-matched-count="1"');
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "temporarily_unavailable" }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM admin_audit_events
         WHERE entity_id = '${draft.id}'
           AND event_type = 'catalog_release.supply_availability_bulk_changed'`,
      )[0]?.count,
    ).toBe(auditBefore);

    for (const [selectorMode, selectorName, selectorValue] of [
      ["worksheet", "sourceWorksheet", "02_压接接头"],
      ["hose_series", "hoseSeries", "601R1"],
    ] as const) {
      const form = new FormData();
      form.set("intent", "preview");
      form.set("releaseId", draft.id);
      form.set("selectorMode", selectorMode);
      form.set(selectorName, selectorValue);
      form.set("target", "discontinued");
      const response = await fetch(`${origin}/admin/catalog/review`, {
        body: form,
        method: "POST",
      });
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain("Confirm bulk change");
      expect(html).toMatch(/data-affected-count="[1-9][0-9]*"/);
      expect(html).toMatch(/data-matched-count="[1-9][0-9]*"/);
    }

    const applySelected = new FormData();
    applySelected.set("intent", "apply");
    applySelected.set("releaseId", draft.id);
    applySelected.set("selectorMode", "selected");
    applySelected.set("selectedSku", "601R1_001");
    applySelected.set("target", "available_for_quote");
    const applyResponse = await fetch(`${origin}/admin/catalog/review`, {
      body: applySelected,
      method: "POST",
      redirect: "manual",
    });
    const applyBody = await applyResponse.text();
    expect(applyResponse.status, applyBody).toBe(302);
    expect(applyResponse.headers.get("location")).toContain("updated=1");
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "available_for_quote" }]);
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${activeImportId}' AND sku = '601R1_001'`,
      ),
    ).toEqual([{ supply_availability: "temporarily_unavailable" }]);

    const audits = runLocalD1<{ payload_json: string }>(
      `SELECT payload_json FROM admin_audit_events
       WHERE entity_id = '${draft.id}'
         AND event_type = 'catalog_release.supply_availability_bulk_changed'
       ORDER BY occurred_at DESC LIMIT 1`,
    );
    expect(JSON.parse(audits[0]?.payload_json ?? "{}")).toMatchObject({
      affectedCount: 1,
      affectedSkus: ["601R1_001"],
      selector: { mode: "selected", skus: ["601R1_001"] },
      target: "available_for_quote",
    });

    const mixed = new FormData();
    mixed.set("intent", "preview");
    mixed.set("releaseId", draft.id);
    mixed.set("selectorMode", "selected");
    mixed.append("selectedSku", "601R1_001");
    mixed.append("selectedSku", "601R1_002");
    mixed.set("target", "available_for_quote");
    const mixedHtml = await (
      await fetch(`${origin}/admin/catalog/review`, {
        body: mixed,
        method: "POST",
      })
    ).text();
    expect(mixedHtml).toContain('data-affected-count="1"');
    expect(mixedHtml).toContain('data-matched-count="2"');

    const zero = new FormData();
    zero.set("intent", "preview");
    zero.set("releaseId", draft.id);
    zero.set("selectorMode", "selected");
    zero.set("selectedSku", "601R1_001");
    zero.set("target", "available_for_quote");
    const zeroHtml = await (
      await fetch(`${origin}/admin/catalog/review`, {
        body: zero,
        method: "POST",
      })
    ).text();
    expect(zeroHtml).toContain('data-affected-count="0"');
    expect(zeroHtml).toContain('data-matched-count="1"');
    expect(zeroHtml).not.toContain("Apply to 0 products");
    runLocalD1(
      `UPDATE catalog_cost_bases SET factory_unit_price = NULL
       WHERE import_id = '${draft.source_import_id}' AND sales_sku = '601R1_001'`,
    );
  });

  it("atomically publishes one release and rejects stale or invalid publication", async () => {
    const [draft] = runLocalD1<{
      id: string;
      release_number: string;
      source_import_id: string;
      version: number;
    }>(
      `SELECT id, release_number, source_import_id, version
       FROM catalog_releases
       WHERE status = 'draft' AND source_import_id IN (
         SELECT id FROM catalog_imports WHERE kind = 'workbook' AND status = 'completed'
       ) ORDER BY created_at DESC LIMIT 1`,
    );
    const [activeBefore] = runLocalD1<{
      active_generation: number;
      id: string;
      release_number: string;
      source_import_id: string;
    }>(
      `SELECT catalog_active_release.version AS active_generation,
              catalog_releases.id, catalog_releases.release_number,
              catalog_releases.source_import_id
       FROM catalog_active_release
       INNER JOIN catalog_releases ON catalog_releases.id = catalog_active_release.release_id
       WHERE catalog_active_release.singleton = 1`,
    );
    expect(draft).toBeTruthy();
    expect(activeBefore).toBeTruthy();
    if (!draft || !activeBefore)
      throw new Error("Expected draft and active releases");

    runLocalD1(
      `UPDATE catalog_skus
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
    );
    const [revalidatedDraftVersion] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );
    expect(revalidatedDraftVersion?.version).toBeGreaterThan(draft.version);
    draft.version = revalidatedDraftVersion?.version ?? draft.version;

    const storefrontBefore = await (await fetch(origin)).text();
    expect(storefrontBefore).toContain("Current catalog");
    const activeProductBefore = await fetch(
      `${origin}/api/catalog/products/601R1_001`,
    );
    expect(activeProductBefore.status).toBe(200);
    const activeProductBeforePayload = await activeProductBefore.json();
    expect(activeProductBeforePayload).toMatchObject({
      product: {
        canAddToQuote: false,
        releaseId: activeBefore.id,
        sku: "601R1_001",
        supplyAvailability: "temporarily_unavailable",
      },
    });

    const previewResponse = await fetch(
      `${origin}/admin/catalog/releases?release=${draft.id}`,
    );
    const previewHtml = await previewResponse.text();
    expect(previewResponse.status).toBe(200);
    expect(previewHtml).toContain("Catalog Releases");
    expect(previewHtml).toContain("Additions");
    expect(previewHtml).toContain("Changes");
    expect(previewHtml).toContain("Hose Series 601R1");
    expect(previewHtml).toContain("View all");
    expect(previewHtml).toContain("Deactivations");
    expect(previewHtml).toContain("Warnings");
    expect(previewHtml).toContain("Blockers");
    expect(previewHtml).not.toContain("Cost Basis");

    const confirm = new FormData();
    confirm.set("intent", "confirm");
    confirm.set("releaseId", draft.id);
    const confirmationResponse = await fetch(
      `${origin}/admin/catalog/releases`,
      { body: confirm, method: "POST" },
    );
    const confirmationHtml = await confirmationResponse.text();
    expect(confirmationResponse.status).toBe(200);
    expect(confirmationHtml).toContain("Final confirmation");
    expect(confirmationHtml).toContain("Publish Catalog Release");

    runLocalD1(
      `DELETE FROM catalog_configurator_registry_entries
       WHERE release_id = '${draft.id}'
         AND registry_type = 'measurement_method'
         AND entry_key = 'M07'`,
    );
    runLocalD1Failure(
      `INSERT INTO catalog_release_publications (
         release_id, previous_release_id, expected_active_version,
         expected_draft_version, published_by, request_correlation_id, published_at
       ) VALUES (
         '${draft.id}', '${activeBefore.id}', ${activeBefore.active_generation},
         ${draft.version}, 'local-owner', 'invalid-registry-${draft.id}',
         CURRENT_TIMESTAMP
       )`,
    );
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${draft.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeBefore.id }]);
    runLocalD1(
      `INSERT INTO catalog_configurator_registry_entries (
         release_id, registry_type, entry_key, payload_json,
         record_version, updated_at
       )
       SELECT '${draft.id}', registry_type, entry_key, payload_json, 1,
              CURRENT_TIMESTAMP
       FROM configurator_registry_seed_templates
       WHERE registry_type = 'measurement_method' AND entry_key = 'M07'`,
    );
    const [draftHoseEnd] = runLocalD1<{ sku: string }>(
      `SELECT sku FROM catalog_hose_ends
       WHERE import_id = '${draft.source_import_id}' ORDER BY sku LIMIT 1`,
    );
    expect(draftHoseEnd).toBeTruthy();
    if (!draftHoseEnd) throw new Error("Expected a draft Hose End");
    runLocalD1(
      `INSERT INTO catalog_configurator_registry_entries (
         release_id, registry_type, entry_key, payload_json,
         record_version, updated_at
       ) VALUES (
         '${draft.id}', 'endpoint_assignment', '${draftHoseEnd.sku}',
         json_object('hoseEndSku', '${draftHoseEnd.sku}',
                     'endpointClassCode', 'NOT_REGISTERED'),
         1, CURRENT_TIMESTAMP
       )`,
    );
    runLocalD1Failure(
      `INSERT INTO catalog_release_publications (
         release_id, previous_release_id, expected_active_version,
         expected_draft_version, published_by, request_correlation_id, published_at
       ) VALUES (
         '${draft.id}', '${activeBefore.id}', ${activeBefore.active_generation},
         ${draft.version}, 'local-owner', 'invalid-endpoint-class-${draft.id}',
         CURRENT_TIMESTAMP
       )`,
    );
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${draft.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeBefore.id }]);
    runLocalD1(
      `DELETE FROM catalog_configurator_registry_entries
       WHERE release_id = '${draft.id}'
         AND registry_type = 'endpoint_assignment'
         AND entry_key = '${draftHoseEnd.sku}'`,
    );

    const registryEdit = new FormData();
    registryEdit.set("intent", "save_estimate_schedule");
    registryEdit.set("releaseId", draft.id);
    registryEdit.set("assemblyServicePriceUsd", "");
    const registryEditResponse = await fetch(
      `${origin}/admin/catalog/reference-data`,
      { body: registryEdit, method: "POST", redirect: "manual" },
    );
    expect(registryEditResponse.status).toBe(302);

    const stalePublish = new FormData();
    stalePublish.set("intent", "publish");
    stalePublish.set("releaseId", draft.id);
    stalePublish.set("expectedDraftVersion", String(draft.version));
    stalePublish.set(
      "expectedActiveGeneration",
      String(activeBefore.active_generation),
    );
    stalePublish.set("expectedActiveReleaseId", activeBefore.id);
    const stalePublishResponse = await fetch(
      `${origin}/admin/catalog/releases`,
      { body: stalePublish, method: "POST" },
    );
    expect(stalePublishResponse.status).toBe(200);
    expect(await stalePublishResponse.text()).toContain(
      "The publication preview is stale",
    );
    const [currentDraftVersion] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );
    expect(currentDraftVersion?.version).toBe(draft.version + 1);
    draft.version = currentDraftVersion?.version ?? draft.version;

    const publish = new FormData();
    publish.set("intent", "publish");
    publish.set("releaseId", draft.id);
    publish.set("expectedDraftVersion", String(draft.version));
    publish.set(
      "expectedActiveGeneration",
      String(activeBefore.active_generation),
    );
    publish.set("expectedActiveReleaseId", activeBefore.id);
    const publishResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: publish,
      headers: { "x-request-id": `smoke-publish-${draft.id}` },
      method: "POST",
      redirect: "manual",
    });
    expect(publishResponse.status, await publishResponse.text()).toBe(302);
    expect(publishResponse.headers.get("location")).toContain(
      `published=${draft.id}`,
    );

    const releases = runLocalD1<{
      id: string;
      published_at: string | null;
      status: string;
    }>(
      `SELECT id, status, published_at FROM catalog_releases
       WHERE id IN ('${activeBefore.id}', '${draft.id}') ORDER BY id`,
    );
    expect(
      releases.find((release) => release.id === activeBefore.id)?.status,
    ).toBe("superseded");
    expect(releases.find((release) => release.id === draft.id)).toMatchObject({
      status: "published",
    });
    expect(
      releases.find((release) => release.id === draft.id)?.published_at,
    ).toBeTruthy();
    const [activeAfter] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT version AS active_generation, release_id
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect(activeAfter?.release_id).toBe(draft.id);
    expect(activeAfter?.active_generation).toBe(
      activeBefore.active_generation + 1,
    );

    const audit = runLocalD1<{
      actor_id: string;
      payload_json: string;
    }>(
      `SELECT actor_id, payload_json FROM admin_audit_events
       WHERE entity_id = '${draft.id}' AND event_type = 'catalog_release.published'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_id).toBe("local-owner");
    const auditPayload = JSON.parse(audit[0]?.payload_json ?? "{}");
    expect(auditPayload).toMatchObject({
      previousReleaseId: activeBefore.id,
      requestCorrelationId: `smoke-publish-${draft.id}`,
    });
    expect(auditPayload).not.toHaveProperty("factoryUnitPrice");
    expect(auditPayload).not.toHaveProperty("costBasis");

    const storefrontAfter = await (await fetch(origin)).text();
    expect(storefrontAfter).toContain("Current catalog");
    expect(storefrontAfter).not.toContain("Cost Basis");
    const activeProductAfter = await fetch(
      `${origin}/api/catalog/products/601R1_002`,
    );
    expect(activeProductAfter.status).toBe(200);
    const activeProductAfterText = await activeProductAfter.text();
    expect(JSON.parse(activeProductAfterText)).toMatchObject({
      product: {
        canAddToQuote: false,
        releaseId: draft.id,
        sku: "601R1_002",
        supplyAvailability: "temporarily_unavailable",
      },
    });
    expect(activeProductAfterText).not.toContain("factory_unit_price");
    expect(activeProductAfterText).not.toContain("costBasis");
    expect(
      (await fetch(`${origin}/api/catalog/products/601R1_001`)).status,
    ).toBe(404);
    const historicalProduct = await fetch(
      `${origin}/api/catalog/releases/${activeBefore.id}/products/601R1_001`,
    );
    expect(historicalProduct.status).toBe(200);
    await expect(historicalProduct.json()).resolves.toMatchObject({
      product: { releaseId: activeBefore.id, sku: "601R1_001" },
    });
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}'
           AND supply_availability = 'temporarily_unavailable'`,
      )[0]?.count,
    ).toBeGreaterThan(0);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_skus
         WHERE import_id = '${activeBefore.source_import_id}'`,
      )[0]?.count,
    ).toBe(1);

    const immutableSkuBefore = runLocalD1<{ supply_availability: string }>(
      `SELECT supply_availability FROM catalog_skus
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
    );
    runLocalD1Failure(
      `UPDATE catalog_skus SET supply_availability = 'discontinued'
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
    );
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_002'`,
      ),
    ).toEqual(immutableSkuBefore);
    const forbiddenSku = `FORBIDDEN_${crypto.randomUUID()}`;
    runLocalD1Failure(
      `INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         'forbidden-${crypto.randomUUID()}', '${draft.source_import_id}',
         '${forbiddenSku}', '01_胶管主数据', 'hose', '601R1',
         'Published', 'Eligible', 'Complete', 'available_for_quote'
       )`,
    );
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_skus WHERE sku = '${forbiddenSku}'`,
      ),
    ).toEqual([{ count: 0 }]);

    const publishedSkuBefore = runLocalD1<{
      supply_availability: string;
    }>(
      `SELECT supply_availability FROM catalog_skus
       WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
    );
    const publishedVersionBefore = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );
    const forbiddenEdit = new FormData();
    forbiddenEdit.set("intent", "apply");
    forbiddenEdit.set("releaseId", draft.id);
    forbiddenEdit.set("selectorMode", "selected");
    forbiddenEdit.set("selectedSku", "601R1_001");
    forbiddenEdit.set("target", "discontinued");
    const forbiddenEditResponse = await fetch(
      `${origin}/admin/catalog/review`,
      { body: forbiddenEdit, method: "POST" },
    );
    expect(forbiddenEditResponse.status).toBe(200);
    expect(await forbiddenEditResponse.text()).toContain(
      "No draft products require this change",
    );
    expect(
      runLocalD1<{ supply_availability: string }>(
        `SELECT supply_availability FROM catalog_skus
         WHERE import_id = '${draft.source_import_id}' AND sku = '601R1_001'`,
      ),
    ).toEqual(publishedSkuBefore);
    expect(
      runLocalD1<{ version: number }>(
        `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
      ),
    ).toEqual(publishedVersionBefore);

    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const nextImport = new FormData();
    nextImport.set(
      "workbook",
      new File([workbook], "next-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const nextImportResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: nextImport,
      method: "POST",
      redirect: "manual",
    });
    const nextImportLocation = nextImportResponse.headers.get("location");
    expect(nextImportResponse.status).toBe(302);
    const nextImportId = new URL(
      nextImportLocation ?? "",
      origin,
    ).searchParams.get("import");
    const [nextDraft] = runLocalD1<{
      id: string;
      version: number;
    }>(
      `SELECT id, version FROM catalog_releases
       WHERE source_import_id = '${nextImportId}' AND status = 'draft'`,
    );
    expect(nextDraft).toBeTruthy();
    if (!nextDraft || !activeAfter) throw new Error("Expected next draft");

    const competingImport = new FormData();
    competingImport.set(
      "workbook",
      new File([workbook], "competing-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const competingImportResponse = await fetch(
      `${origin}/admin/catalog/import`,
      { body: competingImport, method: "POST", redirect: "manual" },
    );
    expect(competingImportResponse.status).toBe(302);
    const competingImportId = new URL(
      competingImportResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    const [competingDraft] = runLocalD1<{ id: string; version: number }>(
      `SELECT id, version FROM catalog_releases
       WHERE source_import_id = '${competingImportId}' AND status = 'draft'`,
    );
    expect(competingDraft).toBeTruthy();
    if (!competingDraft) throw new Error("Expected competing draft");

    const publicationForm = (releaseId: string, releaseVersion: number) => {
      const form = new FormData();
      form.set("intent", "publish");
      form.set("releaseId", releaseId);
      form.set("expectedDraftVersion", String(releaseVersion));
      form.set(
        "expectedActiveGeneration",
        String(activeAfter.active_generation),
      );
      form.set("expectedActiveReleaseId", draft.id);
      return form;
    };
    const competingResponses = await Promise.all(
      [nextDraft, competingDraft].map((candidate) =>
        fetch(`${origin}/admin/catalog/releases`, {
          body: publicationForm(candidate.id, candidate.version),
          headers: { "x-request-id": `concurrent-${candidate.id}` },
          method: "POST",
          redirect: "manual",
        }),
      ),
    );
    expect(
      competingResponses.map((response) => response.status).sort(),
    ).toEqual([200, 302]);
    const [activeWinner] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT release_id, version AS active_generation
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect([nextDraft.id, competingDraft.id]).toContain(
      activeWinner?.release_id,
    );
    const loser =
      activeWinner?.release_id === nextDraft.id ? competingDraft : nextDraft;
    const loserImportId =
      loser.id === nextDraft.id ? nextImportId : competingImportId;
    expect(loserImportId).toBeTruthy();
    const candidateReleases = runLocalD1<{ id: string; status: string }>(
      `SELECT id, status FROM catalog_releases
       WHERE id IN ('${nextDraft.id}', '${competingDraft.id}') ORDER BY id`,
    );
    expect(
      candidateReleases.find(
        (release) => release.id === activeWinner?.release_id,
      )?.status,
    ).toBe("published");
    expect(
      candidateReleases.find((release) => release.id === loser.id)?.status,
    ).toBe("draft");
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM admin_audit_events
         WHERE entity_id = '${loser.id}'
           AND event_type = 'catalog_release.published'`,
      ),
    ).toEqual([{ count: 0 }]);

    const [nextImportSummary] = runLocalD1<{ summary_json: string }>(
      `SELECT summary_json FROM catalog_imports WHERE id = '${loserImportId}'`,
    );
    const expectedSalesOfferCount = Number(
      JSON.parse(nextImportSummary?.summary_json ?? "{}").salesOfferCount,
    );
    const [versionBeforeCorruption] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    runLocalD1(
      `UPDATE catalog_imports
       SET summary_json = json_set(summary_json, '$.salesOfferCount', ${expectedSalesOfferCount + 1})
       WHERE id = '${loserImportId}'`,
    );
    const [versionAfterCorruption] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    expect(versionAfterCorruption?.version).toBe(
      (versionBeforeCorruption?.version ?? 0) + 1,
    );
    runLocalD1Failure(
      `INSERT INTO catalog_release_publications (
         release_id, previous_release_id, expected_active_version,
         expected_draft_version, published_by, request_correlation_id, published_at
       ) VALUES (
         '${loser.id}', '${activeWinner?.release_id}', ${activeWinner?.active_generation},
         ${versionAfterCorruption?.version}, 'local-owner',
         'invalid-${loser.id}', CURRENT_TIMESTAMP
       )`,
    );
    const blockedResponse = await fetch(
      `${origin}/admin/catalog/releases?release=${loser.id}`,
    );
    const blockedHtml = await blockedResponse.text();
    expect(blockedHtml).toContain("count_mismatch_salesOfferCount");
    expect(blockedHtml).toContain("Resolve blockers before publishing");
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeWinner?.release_id }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    runLocalD1(
      `UPDATE catalog_imports
       SET summary_json = json_set(summary_json, '$.salesOfferCount', ${expectedSalesOfferCount})
       WHERE id = '${loserImportId}'`,
    );

    const sourceImportBefore = runLocalD1<{ source_import_id: string }>(
      `SELECT source_import_id FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    runLocalD1Failure(
      `UPDATE catalog_releases SET source_import_id = '${draft.source_import_id}'
       WHERE id = '${loser.id}'`,
    );
    expect(
      runLocalD1<{ source_import_id: string }>(
        `SELECT source_import_id FROM catalog_releases WHERE id = '${loser.id}'`,
      ),
    ).toEqual(sourceImportBefore);

    const [rollbackDraft] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${loser.id}'`,
    );
    const rollbackRequestId = `rollback-${loser.id}`;
    runLocalD1(
      `INSERT INTO admin_audit_events (
         id, event_type, entity_type, entity_id,
         actor_id, payload_json, occurred_at
       ) VALUES (
         'catalog-release-published:${rollbackRequestId}',
         'catalog_release.rollback_fixture', 'catalog_release', '${loser.id}',
         'local-owner', '{}', CURRENT_TIMESTAMP
       )`,
    );
    const rollbackForm = new FormData();
    rollbackForm.set("intent", "publish");
    rollbackForm.set("releaseId", loser.id);
    rollbackForm.set("expectedDraftVersion", String(rollbackDraft?.version));
    rollbackForm.set(
      "expectedActiveGeneration",
      String(activeWinner?.active_generation),
    );
    rollbackForm.set("expectedActiveReleaseId", activeWinner?.release_id ?? "");
    const rollbackResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: rollbackForm,
      headers: { "x-request-id": rollbackRequestId },
      method: "POST",
      redirect: "manual",
    });
    expect(rollbackResponse.status).toBe(200);
    expect(await rollbackResponse.text()).toContain(
      "Catalog Release publication failed.",
    );
    expect(
      runLocalD1<{ release_id: string }>(
        "SELECT release_id FROM catalog_active_release WHERE singleton = 1",
      ),
    ).toEqual([{ release_id: activeWinner?.release_id }]);
    expect(
      runLocalD1<{ status: string }>(
        `SELECT status FROM catalog_releases WHERE id = '${loser.id}'`,
      ),
    ).toEqual([{ status: "draft" }]);
    expect(
      runLocalD1<{ status: string }>(
        `SELECT status FROM catalog_releases WHERE id = '${activeWinner?.release_id}'`,
      ),
    ).toEqual([{ status: "published" }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM catalog_release_publications
         WHERE release_id = '${loser.id}'`,
      ),
    ).toEqual([{ count: 0 }]);
  }, 300_000);

  it("serves the five-class published storefront without exposing cost data", async () => {
    const workbook = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const form = new FormData();
    form.set(
      "workbook",
      new File([workbook], "published-storefront-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    const importId = new URL(
      importResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    expect(importId).toBeTruthy();

    const [draft] = runLocalD1<{ id: string; release_number: string }>(
      `SELECT id, release_number FROM catalog_releases
       WHERE source_import_id = '${importId}' AND status = 'draft'`,
    );
    const [active] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT version AS active_generation, release_id
       FROM catalog_active_release WHERE singleton = 1`,
    );
    expect(draft).toBeTruthy();
    expect(active).toBeTruthy();
    if (!draft || !active || !importId)
      throw new Error("Expected imported draft and active release");

    runLocalD1(
      `UPDATE catalog_skus
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${importId}';
       UPDATE catalog_compatibilities
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${importId}'
         AND rfq_eligibility = 'Eligible';
       UPDATE catalog_skus
       SET supply_availability = 'available_for_quote'
       WHERE import_id = '${importId}'
         AND sku IN (
           '601R1_001', '601R1_002',
           'JIC_F_SW_04_04', 'JIC_F_SW_04_06',
           '601R1_1WB_001', '601R1_1WB_002',
           'ADP_ST_JIC_M_02_NPT_M_02'
         );
       UPDATE catalog_skus
       SET supply_availability = 'discontinued'
       WHERE import_id = '${importId}' AND sku = 'QDC_16028_PLG_04_FNPT_04';`,
    );
    const [draftState] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${draft.id}'`,
    );

    const publish = new FormData();
    publish.set("intent", "publish");
    publish.set("releaseId", draft.id);
    publish.set("expectedDraftVersion", String(draftState?.version));
    publish.set("expectedActiveGeneration", String(active.active_generation));
    publish.set("expectedActiveReleaseId", active.release_id);
    const publishResponse = await fetch(`${origin}/admin/catalog/releases`, {
      body: publish,
      headers: { "x-request-id": `storefront-${draft.id}` },
      method: "POST",
      redirect: "manual",
    });
    expect(publishResponse.status, await publishResponse.text()).toBe(302);

    const storefrontResponse = await fetch(origin);
    const storefront = await storefrontResponse.text();
    expect(storefrontResponse.status).toBe(200);
    expect(storefront).toContain('href="/catalog/hydraulic-hose/');
    expect(storefront).toContain('href="/catalog/hose-ends/');
    expect(storefront).toContain('href="/catalog/ferrules/');
    expect(storefront).toContain('href="/catalog/adapters/');
    expect(storefront).toContain('href="/catalog/quick-couplers/');
    expect(storefront).not.toMatch(
      /href="\/catalog\/(?:hydraulic-hose|hose-ends)\/[^"?]+\?sku=/,
    );
    expect(storefront).not.toContain("Cost Basis");
    expect(storefront).not.toContain("factory_unit_price");
    expect(storefront).toContain('href="/build-a-hose"');

    const [draftWritesBefore] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    const buildBlankResponse = await fetch(`${origin}/build-a-hose`);
    const buildBlank = await buildBlankResponse.text();
    expect(buildBlankResponse.status).toBe(200);
    expect(buildBlank).toContain("Build a Hose");
    expect(buildBlank).toContain("1. Choose a Hose Series");
    expect(buildBlank).toContain("Choose a series to see its exact hose sizes");
    expect(buildBlank).not.toContain('data-hose-sku="601R1_001"');
    expect(buildBlank).not.toContain("Hose selection ready");

    const buildCurrentLinkResponse = await fetch(
      `${origin}/build-a-hose?hose=601R1_001`,
    );
    const buildCurrentLink = await buildCurrentLinkResponse.text();
    expect(buildCurrentLinkResponse.status).toBe(200);
    expect(buildCurrentLink).toContain("This link points to a current hose.");
    expect(buildCurrentLink).not.toContain('data-hose-sku="601R1_001"');
    expect(buildCurrentLink).not.toContain("Hose selection ready");
    expect(buildCurrentLink).toContain("has not been added to your Quote List");

    const compatibleEndAResponse = await fetch(
      `${origin}/api/configurator/compatible-end-a?release=${draft.id}&hose=601R1_002`,
    );
    expect(compatibleEndAResponse.status).toBe(200);
    const compatibleEndA = (await compatibleEndAResponse.json()) as {
      candidates: Array<{
        compatibilityId: string;
        ferrule: { sku: string };
        hoseEndSku: string;
      }>;
      hoseSku: string;
      releaseId: string;
    };
    expect(compatibleEndA.hoseSku).toBe("601R1_002");
    expect(compatibleEndA.releaseId).toBe(draft.id);
    expect(compatibleEndA.candidates).toEqual([
      expect.objectContaining({
        compatibilityId: "COMP_0011",
        ferrule: expect.objectContaining({ sku: "601R1_1WB_002" }),
        hoseEndSku: "JIC_F_SW_04_04",
      }),
    ]);
    expect(
      compatibleEndA.candidates.some(
        (candidate) => candidate.hoseEndSku === "JIC_F_SW_04_06",
      ),
    ).toBe(false);
    expect(
      await fetch(`${origin}/api/configurator/compatible-end-a`),
    ).toMatchObject({ status: 400 });

    const buildUnavailable = await (
      await fetch(`${origin}/build-a-hose?hose=601R1_003`)
    ).text();
    expect(buildUnavailable).toContain(
      "This hose is not currently selectable.",
    );
    const buildInvalid = await (
      await fetch(`${origin}/build-a-hose?hose=SUPERSEDED_HOSE`)
    ).text();
    expect(buildInvalid).toContain(
      "This hose link is not in the current catalog.",
    );
    const [draftWritesAfter] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    expect(draftWritesAfter).toEqual(draftWritesBefore);

    const registryRows = runLocalD1<{
      entry_key: string;
      record_version: number;
      registry_type: string;
    }>(
      `SELECT registry_type, entry_key, record_version
       FROM catalog_configurator_registry_entries
       WHERE release_id = '${draft.id}'
         AND (
           (registry_type = 'measurement_method' AND entry_key = 'M02') OR
           (registry_type = 'installed_protection' AND entry_key = 'NONE') OR
           (registry_type = 'assembly_estimate_schedule' AND entry_key = 'DEFAULT')
         )`,
    );
    const registryVersion = (type: string, key: string) =>
      registryRows.find(
        (row) => row.registry_type === type && row.entry_key === key,
      )?.record_version;
    const measurementVersion = registryVersion("measurement_method", "M02");
    const protectionVersion = registryVersion("installed_protection", "NONE");
    const estimateScheduleVersion = registryVersion(
      "assembly_estimate_schedule",
      "DEFAULT",
    );
    expect(measurementVersion).toBeTypeOf("number");
    expect(protectionVersion).toBeTypeOf("number");
    expect(estimateScheduleVersion).toBeTypeOf("number");

    const assemblyDraft = (length: string) => ({
      catalogRelease: { id: draft.id },
      endA: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "JIC_F_SW_04_04" },
      },
      endB: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "JIC_F_SW_04_04" },
      },
      finishedLength: {
        originalUnit: "in",
        originalValue: length,
        requestedTighterTolerance: false,
        tolerance: {
          scheduleCode: "SAE_J517_ASSEMBLY_LENGTH",
          scheduleVersion: "1.0.0",
        },
      },
      hose: { sku: "601R1_002" },
      installedProtection: {
        code: "NONE",
        recordVersion: protectionVersion,
      },
      lengthReferencePricing: {
        scheduleRecordVersion: estimateScheduleVersion,
      },
      measurementSelection: {
        method: { code: "M02", recordVersion: measurementVersion },
        state: "selected",
      },
    });
    const addConfiguredAssembly = (
      draftValue: unknown,
      quantity: number,
      cookie?: string,
      replaceLineId?: string,
    ) => {
      const form = new FormData();
      form.set("draft", JSON.stringify(draftValue));
      form.set("quantity", String(quantity));
      if (replaceLineId) form.set("replaceLineId", replaceLineId);
      return fetch(`${origin}/api/configurator/quote-assembly`, {
        body: form,
        headers: cookie ? { cookie } : undefined,
        method: "POST",
      });
    };

    const configuredAdd = await addConfiguredAssembly(assemblyDraft("24"), 1);
    expect(configuredAdd.status, await configuredAdd.text()).toBe(200);
    const configuredCookie = cookieHeader(configuredAdd);
    const configuredSessionId = sessionIdFromCookie(configuredCookie);
    const [configuredLine] = runLocalD1<{
      configured_estimate_inputs_json: string;
      configured_snapshot_json: string;
      configured_unit_estimate_amount: number | null;
      id: string;
      line_kind: string;
      quantity: number;
    }>(
      `SELECT id, line_kind, quantity, configured_snapshot_json,
              configured_estimate_inputs_json,
              configured_unit_estimate_amount
       FROM anonymous_quote_lines
       WHERE session_id = '${configuredSessionId}'`,
    );
    expect(configuredLine).toMatchObject({
      configured_unit_estimate_amount: 28.86,
      line_kind: "configured_assembly",
      quantity: 1,
    });
    const configuredSnapshot = JSON.parse(
      configuredLine?.configured_snapshot_json ?? "{}",
    ) as {
      configuration?: {
        endA?: {
          compatibilityId?: string;
          ferrule?: { sku?: string };
          hoseEnd?: { sku?: string };
        };
        endB?: {
          compatibilityId?: string;
          ferrule?: { sku?: string };
          hoseEnd?: { sku?: string };
        };
        finishedLength?: {
          originalValue?: string;
          tolerance?: { scheduleVersion?: string };
        };
        hose?: { sku?: string };
        installedProtection?: { code?: string; recordVersion?: number };
        measurementSelection?: {
          diagram?: { assetVersion?: string; overlayVersion?: string };
          method?: { code?: string; recordVersion?: number };
        };
      };
      review?: { issues?: unknown[]; outcome?: string };
      sourceCatalogRelease?: { id?: string };
    };
    expect(configuredSnapshot.configuration).toMatchObject({
      endA: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "JIC_F_SW_04_04" },
      },
      endB: {
        compatibilityId: "COMP_0011",
        ferrule: { sku: "601R1_1WB_002" },
        hoseEnd: { sku: "JIC_F_SW_04_04" },
      },
      finishedLength: {
        originalValue: "24",
        tolerance: { scheduleVersion: "1.0.0" },
      },
      hose: { sku: "601R1_002" },
      installedProtection: {
        code: "NONE",
        recordVersion: protectionVersion,
      },
      measurementSelection: {
        diagram: {
          assetVersion: expect.any(String),
          overlayVersion: expect.any(String),
        },
        method: { code: "M02", recordVersion: measurementVersion },
      },
    });
    expect(configuredSnapshot.configuration).not.toHaveProperty("clocking");
    expect(configuredSnapshot.configuration).not.toHaveProperty(
      "applicationRequirements",
    );
    expect(configuredSnapshot.review).toMatchObject({
      issues: expect.any(Array),
      outcome: "technical_review",
    });
    expect(configuredSnapshot.sourceCatalogRelease).toEqual({
      id: draft.id,
      number: draft.release_number,
    });
    expect(
      JSON.parse(configuredLine?.configured_estimate_inputs_json ?? "{}"),
    ).toMatchObject({
      basis: "versioned_reference_inputs",
      hoseCutLengthFeet: 2,
      protectionRecordVersion: protectionVersion,
      scheduleRecordVersion: estimateScheduleVersion,
    });

    const staleToleranceDraft = assemblyDraft("24");
    staleToleranceDraft.finishedLength.tolerance.scheduleVersion = "0.9.0";
    const [countsBeforeStaleReference] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    const staleToleranceAdd = await addConfiguredAssembly(
      staleToleranceDraft,
      1,
    );
    expect(staleToleranceAdd.status).toBe(409);
    const malformedStateDraft = assemblyDraft("24");
    malformedStateDraft.measurementSelection.state = "invalid";
    const malformedStateAdd = await addConfiguredAssembly(
      malformedStateDraft,
      1,
    );
    expect(malformedStateAdd.status).toBe(409);
    const [countsAfterStaleReference] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    expect(countsAfterStaleReference).toEqual(countsBeforeStaleReference);

    const configuredMerge = await addConfiguredAssembly(
      assemblyDraft("24"),
      2,
      configuredCookie,
    );
    expect(configuredMerge.status, await configuredMerge.text()).toBe(200);
    const configuredSeparate = await addConfiguredAssembly(
      assemblyDraft("30"),
      1,
      configuredCookie,
    );
    expect(configuredSeparate.status, await configuredSeparate.text()).toBe(
      200,
    );
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE session_id = '${configuredSessionId}'
           AND line_kind = 'configured_assembly'
         ORDER BY quantity DESC`,
      ),
    ).toEqual([{ quantity: 3 }, { quantity: 1 }]);

    const configuredQuoteList = await (
      await fetch(`${origin}/quote-list`, {
        headers: { cookie: configuredCookie },
      })
    ).text();
    expect(configuredQuoteList).toContain("USD 83.58");
    expect(configuredQuoteList).toContain("USD 28.94");
    expect(configuredQuoteList).toContain("JIC_F_SW_04_04");

    runLocalD1(
      `UPDATE anonymous_quote_sessions
       SET last_activity_at = '2026-01-01T00:00:00.000Z'
       WHERE id = '${configuredSessionId}'`,
    );
    const [sessionBeforeFailure] = runLocalD1<{
      last_activity_at: string;
    }>(
      `SELECT last_activity_at FROM anonymous_quote_sessions
       WHERE id = '${configuredSessionId}'`,
    );
    const configuredOverflow = await addConfiguredAssembly(
      assemblyDraft("24"),
      9999,
      configuredCookie,
    );
    expect(configuredOverflow.status).toBe(409);
    const [configuredAfterFailure] = runLocalD1<{
      last_activity_at: string;
      quantity: number;
    }>(
      `SELECT l.quantity, s.last_activity_at
       FROM anonymous_quote_lines l
       INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
       WHERE l.id = '${configuredLine?.id ?? ""}'`,
    );
    expect(configuredAfterFailure).toEqual({
      last_activity_at: sessionBeforeFailure?.last_activity_at,
      quantity: 3,
    });

    const configuredBeforeEdit = runLocalD1<{
      configured_snapshot_json: string;
      id: string;
      quantity: number;
    }>(
      `SELECT id, quantity, configured_snapshot_json
       FROM anonymous_quote_lines
       WHERE session_id = '${configuredSessionId}'
         AND line_kind = 'configured_assembly'
       ORDER BY quantity DESC`,
    );
    const separateConfiguredLine = configuredBeforeEdit.find((line) => {
      const snapshot = JSON.parse(line.configured_snapshot_json) as {
        configuration?: { finishedLength?: { originalValue?: string } };
      };
      return snapshot.configuration?.finishedLength?.originalValue === "30";
    });
    expect(separateConfiguredLine).toBeDefined();

    const editDraftResponse = await fetch(
      `${origin}/build-a-hose?mode=edit&quoteLine=${separateConfiguredLine?.id}`,
      { headers: { cookie: configuredCookie } },
    );
    const editDraftPage = await editDraftResponse.text();
    expect(editDraftPage).toContain("Editing Quote List assembly");
    expect(editDraftPage).toContain("Save Changes");
    expect(editDraftPage).toContain("Changes remain isolated");
    expect(editDraftPage).toContain('href="/quote-list"');
    expect(editDraftResponse.headers.get("set-cookie")).toContain(
      "hs_quote_session=",
    );
    await fetch(`${origin}/quote-list`, {
      headers: { cookie: configuredCookie },
    });
    expect(
      runLocalD1<{
        configured_snapshot_json: string;
        quantity: number;
      }>(
        `SELECT quantity, configured_snapshot_json
         FROM anonymous_quote_lines
         WHERE id = '${separateConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([
      {
        configured_snapshot_json:
          separateConfiguredLine?.configured_snapshot_json,
        quantity: separateConfiguredLine?.quantity,
      },
    ]);
    const duplicateDraftPage = await (
      await fetch(
        `${origin}/build-a-hose?mode=duplicate&quoteLine=${separateConfiguredLine?.id}`,
        { headers: { cookie: configuredCookie } },
      )
    ).text();
    expect(duplicateDraftPage).toContain("Duplicating Quote List assembly");
    expect(duplicateDraftPage).toContain("Add Duplicate to Quote");
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines
         WHERE session_id = '${configuredSessionId}'
           AND line_kind = 'configured_assembly'`,
      ),
    ).toEqual([{ count: 2 }]);

    const saveDuplicate = await addConfiguredAssembly(
      assemblyDraft("30"),
      1,
      configuredCookie,
    );
    expect(saveDuplicate.status, await saveDuplicate.text()).toBe(200);
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE id = '${separateConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([{ quantity: 2 }]);

    const saveEditedConfiguration = await addConfiguredAssembly(
      assemblyDraft("36"),
      1,
      configuredCookie,
      separateConfiguredLine?.id,
    );
    expect(
      saveEditedConfiguration.status,
      await saveEditedConfiguration.text(),
    ).toBe(200);
    const configuredAfterSave = runLocalD1<{
      configured_snapshot_json: string;
      id: string;
      quantity: number;
    }>(
      `SELECT id, quantity, configured_snapshot_json
       FROM anonymous_quote_lines
       WHERE session_id = '${configuredSessionId}'
         AND line_kind = 'configured_assembly'
       ORDER BY quantity DESC`,
    );
    const editedConfiguredLine = configuredAfterSave.find((line) => {
      const snapshot = JSON.parse(line.configured_snapshot_json) as {
        configuration?: { finishedLength?: { originalValue?: string } };
      };
      return snapshot.configuration?.finishedLength?.originalValue === "36";
    });
    expect(editedConfiguredLine).toMatchObject({ quantity: 1 });
    expect(
      configuredAfterSave.some((line) =>
        line.configured_snapshot_json.includes('"originalValue":"30"'),
      ),
    ).toBe(false);

    const mergeEditedConfiguration = await addConfiguredAssembly(
      assemblyDraft("24"),
      1,
      configuredCookie,
      editedConfiguredLine?.id,
    );
    expect(
      mergeEditedConfiguration.status,
      await mergeEditedConfiguration.text(),
    ).toBe(200);
    const [mergedConfiguredLine] = runLocalD1<{
      id: string;
      quantity: number;
    }>(
      `SELECT id, quantity FROM anonymous_quote_lines
       WHERE session_id = '${configuredSessionId}'
         AND line_kind = 'configured_assembly'`,
    );
    expect(mergedConfiguredLine).toMatchObject({ quantity: 4 });
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines
         WHERE session_id = '${configuredSessionId}'
           AND line_kind = 'configured_assembly'`,
      ),
    ).toEqual([{ count: 1 }]);

    const configuredQuantity = new FormData();
    configuredQuantity.set("intent", "update-configured-assembly");
    configuredQuantity.set("lineId", mergedConfiguredLine?.id ?? "");
    configuredQuantity.set("quantity", "2");
    const configuredQuantityResponse = await fetch(`${origin}/quote-list`, {
      body: configuredQuantity,
      headers: { cookie: configuredCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(configuredQuantityResponse.status).toBe(302);
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([{ quantity: 2 }]);

    const updateConfiguredQuantity = async (quantity: string) => {
      const form = new FormData();
      form.set("intent", "update-configured-assembly");
      form.set("lineId", mergedConfiguredLine?.id ?? "");
      form.set("quantity", quantity);
      return fetch(`${origin}/quote-list`, {
        body: form,
        headers: { cookie: configuredCookie },
        method: "POST",
        redirect: "manual",
      });
    };
    expect((await updateConfiguredQuantity("0")).status).toBe(409);
    expect((await updateConfiguredQuantity("9999")).status).toBe(302);
    expect((await updateConfiguredQuantity("10000")).status).toBe(409);
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([{ quantity: 9999 }]);
    expect((await updateConfiguredQuantity("2")).status).toBe(302);

    const mixedStandard = new FormData();
    mixedStandard.set("intent", "add");
    mixedStandard.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    mixedStandard.set("quantity", "1");
    const mixedStandardResponse = await fetch(`${origin}/quote-list`, {
      body: mixedStandard,
      headers: { cookie: configuredCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(mixedStandardResponse.status).toBe(302);

    const mixedLengthBasedHose = new FormData();
    mixedLengthBasedHose.set("intent", "add-length-hose");
    mixedLengthBasedHose.set("sku", "601R1_001");
    mixedLengthBasedHose.set("lengthPerPiece", "5");
    mixedLengthBasedHose.set("lengthUnit", "ft");
    mixedLengthBasedHose.set("pieceCount", "1");
    const mixedLengthBasedHoseResponse = await fetch(
      `${origin}/catalog/hydraulic-hose/601r1?sku=601R1_001`,
      {
        body: mixedLengthBasedHose,
        headers: { cookie: configuredCookie },
        method: "POST",
        redirect: "manual",
      },
    );
    expect(mixedLengthBasedHoseResponse.status).toBe(302);
    expect(
      runLocalD1<{ line_kind: string }>(
        `SELECT line_kind FROM anonymous_quote_lines
         WHERE session_id = '${configuredSessionId}'
         ORDER BY line_kind`,
      ),
    ).toEqual([
      { line_kind: "configured_assembly" },
      { line_kind: "length_based_hose" },
      { line_kind: "standard" },
    ]);

    const [countsBeforeCatalogFailure] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    runLocalD1(
      `UPDATE catalog_active_release
       SET release_id = '${active.release_id}', version = version + 1
       WHERE singleton = 1`,
    );
    const changedCatalogAdd = await addConfiguredAssembly(
      assemblyDraft("24"),
      1,
    );
    expect(changedCatalogAdd.status).toBe(409);
    const changedCatalogEdit = await addConfiguredAssembly(
      assemblyDraft("36"),
      2,
      configuredCookie,
      mergedConfiguredLine?.id,
    );
    expect(changedCatalogEdit.status).toBe(409);
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([{ quantity: 2 }]);
    const [countsAfterCatalogFailure] = runLocalD1<{
      lines: number;
      sessions: number;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM anonymous_quote_sessions) AS sessions,
         (SELECT COUNT(*) FROM anonymous_quote_lines) AS lines`,
    );
    expect(countsAfterCatalogFailure).toEqual(countsBeforeCatalogFailure);
    const staleConfiguredQuoteList = await (
      await fetch(`${origin}/quote-list`, {
        headers: { cookie: configuredCookie },
      })
    ).text();
    expect(staleConfiguredQuoteList).toContain(
      "This saved configuration no longer matches the current catalog",
    );
    expect(staleConfiguredQuoteList).toMatch(
      /The selected Hose or Catalog Release changed|One or both Hose End combinations changed|current configuration reference data is unavailable/,
    );
    expect(staleConfiguredQuoteList).toContain("Edit Configuration");
    expect(staleConfiguredQuoteList).toContain("Duplicate and Edit");
    const staleConfiguredEdit = await (
      await fetch(
        `${origin}/build-a-hose?mode=edit&quoteLine=${mergedConfiguredLine?.id}`,
        { headers: { cookie: configuredCookie } },
      )
    ).text();
    expect(staleConfiguredEdit).toContain(
      "This saved configuration no longer matches the current catalog",
    );
    expect(staleConfiguredEdit).toContain("Configuration Trace");
    expect(staleConfiguredEdit).toContain(`<dd>${draft.release_number}</dd>`);
    expect(
      runLocalD1<{ configured_snapshot_json: string; quantity: number }>(
        `SELECT configured_snapshot_json, quantity
         FROM anonymous_quote_lines
         WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
      ),
    ).toEqual([
      {
        configured_snapshot_json: configuredBeforeEdit.find(
          (line) => line.id !== separateConfiguredLine?.id,
        )?.configured_snapshot_json,
        quantity: 2,
      },
    ]);
    runLocalD1(
      `UPDATE catalog_active_release
       SET release_id = '${draft.id}', version = version + 1
       WHERE singleton = 1`,
    );

    runLocalD1(
      `UPDATE anonymous_quote_lines
       SET configured_snapshot_json = json_set(
         configured_snapshot_json,
         '$.configuration.lengthReferencePricing.scheduleRecordVersion',
         ${(estimateScheduleVersion ?? 1) - 1}
       )
       WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
    );
    const changedReferenceEdit = await (
      await fetch(
        `${origin}/build-a-hose?mode=edit&quoteLine=${mergedConfiguredLine?.id}`,
        { headers: { cookie: configuredCookie } },
      )
    ).text();
    expect(changedReferenceEdit).toContain(
      "Installed Protection and its estimate are retained, but an upstream selection or price schedule changed.",
    );
    expect(changedReferenceEdit).toMatch(
      /<button[^>]*disabled=""[^>]*>\s*Save Changes\s*<\/button>/,
    );
    runLocalD1(
      `UPDATE anonymous_quote_lines
       SET configured_snapshot_json = json_set(
         configured_snapshot_json,
         '$.configuration.lengthReferencePricing.scheduleRecordVersion',
         ${estimateScheduleVersion ?? 1}
       )
       WHERE id = '${mergedConfiguredLine?.id ?? ""}'`,
    );

    const removeConfigured = new FormData();
    removeConfigured.set("intent", "remove");
    removeConfigured.set("lineId", mergedConfiguredLine?.id ?? "");
    const removeConfiguredResponse = await fetch(`${origin}/quote-list`, {
      body: removeConfigured,
      headers: { cookie: configuredCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(removeConfiguredResponse.status).toBe(302);
    expect(
      runLocalD1<{ line_kind: string }>(
        `SELECT line_kind FROM anonymous_quote_lines
         WHERE session_id = '${configuredSessionId}'
         ORDER BY line_kind`,
      ),
    ).toEqual([{ line_kind: "length_based_hose" }, { line_kind: "standard" }]);

    const search = await (await fetch(`${origin}/?q=9%2F16-18+UNF`)).text();
    expect(search).toContain("JIC 37° Female Swivel 0° Straight Hose End");
    expect(search).toContain("JIC_F_SW_06_");

    const aliasSearch = await (await fetch(`${origin}/?q=FBSPX-04-04W`)).text();
    expect(aliasSearch).toContain("BSPP Female Swivel 0° Straight Hose End");
    expect(aliasSearch).toContain("BSPP_F_SW_04_04");

    const availablePath =
      "/catalog/hose-ends/jic-37-female-swivel-0-straight?sku=JIC_F_SW_04_04";
    const available = await (await fetch(`${origin}${availablePath}`)).text();
    expect(available).toContain("SAE J514");
    expect(available).toContain("9/16-18 UNF");
    expect(available).toContain("Available for Quote");
    expect(available).toContain("1. Connection Dash");
    expect(available).toContain("2. Hose Tail Dash");
    expect(available).toContain('data-connection-dash="-4"');
    expect(available).toContain('data-hose-tail-dash="-4"');
    expect(available).toContain("7/16-20 UNF");
    expect(available).toContain("1/4 in hose ID");
    expect(available).toContain(
      'aria-label="Select 7/16-20 UNF, Connection Dash -4"',
    );
    expect(available).toContain(
      'aria-label="Select 1/4 in hose ID, Hose Tail Dash -4"',
    );
    expect(available).toMatch(
      /<strong>7\/16-20 UNF<\/strong><small>Connection Dash -4<\/small>/,
    );
    expect(available).toMatch(
      /<strong>1\/4 in hose ID<\/strong><small>Hose Tail Dash -4<\/small>/,
    );
    expect(available).not.toContain("Size / connection variant");
    expect(available).toMatch(
      /<button[^>]*product-quote-command[^>]*>[^]*Add to Quote/,
    );
    expect(available).toContain('data-command="add-to-quote"');
    expect(available).toContain('data-sku="JIC_F_SW_04_04"');
    expect(available).not.toMatch(/product-quote-command[^>]*disabled/);
    expect(available).toContain("14 calendar days");
    expect(available).toContain("10% restocking fee");

    const lengthBasedAdd = new FormData();
    lengthBasedAdd.set("intent", "add");
    lengthBasedAdd.set("sku", "601R1_001");
    lengthBasedAdd.set("quantity", "1");
    const lengthBasedAddResponse = await fetch(`${origin}/quote-list`, {
      body: lengthBasedAdd,
      method: "POST",
    });
    expect(lengthBasedAddResponse.status).toBe(409);
    expect(await lengthBasedAddResponse.text()).toContain(
      "requires length or configuration details",
    );

    const renderedQuoteForm = quoteFormFromProductDetail(available);
    const addResponse = await fetch(`${origin}${renderedQuoteForm.action}`, {
      body: renderedQuoteForm.form,
      method: "POST",
      redirect: "manual",
    });
    expect(addResponse.status, await addResponse.text()).toBe(302);
    expect(addResponse.headers.get("location")).toBe("/quote-list");
    const quoteCookie = cookieHeader(addResponse);
    expect(quoteCookie).not.toContain("JIC_F_SW_04_04");
    const sessionId = sessionIdFromCookie(quoteCookie);

    const quoteListResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: quoteCookie },
    });
    const quoteList = await quoteListResponse.text();
    expect(quoteListResponse.status).toBe(200);
    expect(quoteList).toContain("Quote List");
    expect(quoteList).toContain("JIC_F_SW_04_04");
    expect(quoteList).toContain('value="1"');
    expect(quoteListResponse.headers.get("set-cookie")).toContain(
      "Max-Age=2592000",
    );

    const addAgain = new FormData();
    addAgain.set("intent", "add");
    addAgain.set("sku", "JIC_F_SW_04_04");
    addAgain.set("quantity", "2");
    const mergeResponse = await fetch(`${origin}/quote-list`, {
      body: addAgain,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(mergeResponse.status).toBe(302);
    const [mergedLine] = runLocalD1<{ id: string; quantity: number }>(
      `SELECT id, quantity FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}' AND sku = 'JIC_F_SW_04_04'`,
    );
    expect(mergedLine?.quantity).toBe(3);
    runLocalD1Failure(
      `UPDATE anonymous_quote_lines SET piece_count = 1
       WHERE id = '${mergedLine?.id ?? ""}';`,
    );
    expect(
      runLocalD1<{ piece_count: number | null; quantity: number }>(
        `SELECT piece_count, quantity FROM anonymous_quote_lines
         WHERE id = '${mergedLine?.id ?? ""}'`,
      ),
    ).toEqual([{ piece_count: null, quantity: 3 }]);

    const addDifferent = new FormData();
    addDifferent.set("intent", "add");
    addDifferent.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    addDifferent.set("quantity", "1");
    const differentResponse = await fetch(`${origin}/quote-list`, {
      body: addDifferent,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(differentResponse.status).toBe(302);
    const [lineCount] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}'`,
    );
    expect(lineCount?.count).toBe(2);

    const update = new FormData();
    update.set("intent", "update");
    update.set("lineId", mergedLine?.id ?? "");
    update.set("quantity", "5");
    const updateResponse = await fetch(`${origin}/quote-list`, {
      body: update,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(updateResponse.status).toBe(302);

    const autosaveQuantity = new FormData();
    autosaveQuantity.set("intent", "autosave-quantity");
    autosaveQuantity.set("lineId", mergedLine?.id ?? "");
    autosaveQuantity.set("lineKind", "standard");
    autosaveQuantity.set("quantity", "6");
    const autosaveQuantityResponse = await fetch(`${origin}/quote-list`, {
      body: autosaveQuantity,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(autosaveQuantityResponse.status).toBe(200);
    expect(
      runLocalD1<{ quantity: number }>(
        `SELECT quantity FROM anonymous_quote_lines
         WHERE id = '${mergedLine?.id ?? ""}'`,
      ),
    ).toEqual([{ quantity: 6 }]);

    const invalidQuantity = new FormData();
    invalidQuantity.set("intent", "update");
    invalidQuantity.set("lineId", mergedLine?.id ?? "");
    invalidQuantity.set("quantity", "10000");
    const invalidQuantityResponse = await fetch(`${origin}/quote-list`, {
      body: invalidQuantity,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(invalidQuantityResponse.status).toBe(409);
    expect(await invalidQuantityResponse.text()).toContain(
      "Quantity must be a whole number from 1 to 9,999.",
    );

    const maximumQuantity = new FormData();
    maximumQuantity.set("intent", "update");
    maximumQuantity.set("lineId", mergedLine?.id ?? "");
    maximumQuantity.set("quantity", "9999");
    const maximumQuantityResponse = await fetch(`${origin}/quote-list`, {
      body: maximumQuantity,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(maximumQuantityResponse.status).toBe(302);

    const overflowAdd = new FormData();
    overflowAdd.set("intent", "add");
    overflowAdd.set("sku", "JIC_F_SW_04_04");
    overflowAdd.set("quantity", "1");
    const overflowAddResponse = await fetch(`${origin}/quote-list`, {
      body: overflowAdd,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(overflowAddResponse.status).toBe(409);
    expect(await overflowAddResponse.text()).toContain(
      "The combined quantity must be between 1 and 9,999.",
    );
    const [quantityAfterOverflow] = runLocalD1<{ quantity: number }>(
      `SELECT quantity FROM anonymous_quote_lines
       WHERE id = '${mergedLine?.id ?? ""}'`,
    );
    expect(quantityAfterOverflow?.quantity).toBe(9999);

    const restoreQuantity = new FormData();
    restoreQuantity.set("intent", "update");
    restoreQuantity.set("lineId", mergedLine?.id ?? "");
    restoreQuantity.set("quantity", "5");
    const restoreQuantityResponse = await fetch(`${origin}/quote-list`, {
      body: restoreQuantity,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(restoreQuantityResponse.status).toBe(302);

    runLocalD1(
      `INSERT INTO cutting_labeling_fee_rates
         (scope_key, hose_series, currency, rate_per_piece, version)
       VALUES ('series:601R1', '601R1', 'USD', 1.25, 2)
       ON CONFLICT(scope_key) DO UPDATE SET
         rate_per_piece = excluded.rate_per_piece,
         version = excluded.version;`,
    );
    const hosePath = "/catalog/hydraulic-hose/601r1?sku=601R1_001";
    const hoseDetailResponse = await fetch(`${origin}${hosePath}`);
    const hoseDetail = await hoseDetailResponse.text();
    expect(hoseDetailResponse.status).toBe(200);
    expect(hoseDetail).toContain("Length per piece");
    expect(hoseDetail).toContain("Number of pieces");
    const hoseDetailText = renderedText(hoseDetail);
    expect(hoseDetailText).toContain("25 ft");
    expect(hoseDetailText).toContain("50 ft");
    expect(hoseDetailText).toContain("100 ft");
    expect(hoseDetail).toContain('name="lengthPerPiece"');
    expect(hoseDetail).toContain('name="pieceCount"');
    expect(hoseDetail).toMatch(
      /data-command="add-length-hose-to-quote"[^>]*disabled/,
    );

    const lineCountBeforeInvalidLength = lineCount?.count ?? 0;
    const invalidLengthOrder = new FormData();
    invalidLengthOrder.set("intent", "add-length-hose");
    invalidLengthOrder.set("sku", "601R1_001");
    invalidLengthOrder.set("lengthPerPiece", "");
    invalidLengthOrder.set("lengthUnit", "ft");
    invalidLengthOrder.set("pieceCount", "0");
    const invalidLengthResponse = await fetch(`${origin}${hosePath}`, {
      body: invalidLengthOrder,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(invalidLengthResponse.status).toBe(422);
    const invalidLengthMarkup = await invalidLengthResponse.text();
    expect(invalidLengthMarkup).toContain(
      '<small class="field-error" id="length-error" role="alert">Enter the length of each piece.</small>',
    );
    expect(invalidLengthMarkup).toContain(
      "Pieces must be a whole number from 1 to 9,999.",
    );

    const unsupportedUnitOrder = new FormData();
    unsupportedUnitOrder.set("intent", "add-length-hose");
    unsupportedUnitOrder.set("sku", "601R1_001");
    unsupportedUnitOrder.set("lengthPerPiece", "50");
    unsupportedUnitOrder.set("lengthUnit", "m");
    unsupportedUnitOrder.set("pieceCount", "1");
    const unsupportedUnitResponse = await fetch(`${origin}${hosePath}`, {
      body: unsupportedUnitOrder,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(unsupportedUnitResponse.status).toBe(422);
    expect(await unsupportedUnitResponse.text()).toContain(
      '<small class="field-error" id="length-error" role="alert">Only feet (ft) are supported for cut hose.</small>',
    );
    const [lineCountAfterInvalidLength] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}'`,
    );
    expect(lineCountAfterInvalidLength?.count).toBe(
      lineCountBeforeInvalidLength,
    );

    const addCutHose = async (length: number, pieces: number) => {
      const form = new FormData();
      form.set("intent", "add-length-hose");
      form.set("sku", "601R1_001");
      form.set("lengthPerPiece", String(length));
      form.set("lengthUnit", "ft");
      form.set("pieceCount", String(pieces));
      return fetch(`${origin}${hosePath}`, {
        body: form,
        headers: { cookie: quoteCookie },
        method: "POST",
        redirect: "manual",
      });
    };

    const addFiftyFootResponse = await addCutHose(50, 2);
    expect(addFiftyFootResponse.status, await addFiftyFootResponse.text()).toBe(
      302,
    );
    expect(addFiftyFootResponse.headers.get("location")).toBe("/quote-list");
    const [fiftyFootLine] = runLocalD1<{
      current_estimate_amount: number;
      cutting_labeling_fee_amount: number;
      cutting_labeling_fee_rate: number;
      estimated_merchandise_amount: number;
      id: string;
      line_identity: string;
      line_kind: string;
      normalized_length_ft: number;
      original_length_unit: string;
      original_length_value: number;
      piece_count: number;
      quantity: number;
      total_footage: number;
    }>(
      `SELECT id, line_identity, line_kind, quantity,
              original_length_value, original_length_unit,
              normalized_length_ft, piece_count, total_footage,
              cutting_labeling_fee_rate, cutting_labeling_fee_amount,
              estimated_merchandise_amount, current_estimate_amount
       FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}'
         AND line_identity = 'length-hose:601R1_001:50ft'`,
    );
    expect(fiftyFootLine).toMatchObject({
      current_estimate_amount: 218.5,
      cutting_labeling_fee_amount: 2.5,
      cutting_labeling_fee_rate: 1.25,
      estimated_merchandise_amount: 216,
      line_identity: "length-hose:601R1_001:50ft",
      line_kind: "length_based_hose",
      normalized_length_ft: 50,
      original_length_unit: "ft",
      original_length_value: 50,
      piece_count: 2,
      quantity: 2,
      total_footage: 100,
    });

    const mergeFiftyFootResponse = await addCutHose(50, 1);
    expect(mergeFiftyFootResponse.status).toBe(302);
    const addTwentyFiveFootResponse = await addCutHose(25, 1);
    expect(addTwentyFiveFootResponse.status).toBe(302);
    const hoseLines = runLocalD1<{
      current_estimate_amount: number;
      id: string;
      normalized_length_ft: number;
      piece_count: number;
      total_footage: number;
    }>(
      `SELECT id, normalized_length_ft, piece_count, total_footage,
              current_estimate_amount
       FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}' AND sku = '601R1_001'
       ORDER BY normalized_length_ft`,
    );
    expect(hoseLines).toMatchObject([
      {
        current_estimate_amount: 55.25,
        normalized_length_ft: 25,
        piece_count: 1,
        total_footage: 25,
      },
      {
        current_estimate_amount: 327.75,
        normalized_length_ft: 50,
        piece_count: 3,
        total_footage: 150,
      },
    ]);

    const overflowCutHoseResponse = await addCutHose(50, 9999);
    expect(overflowCutHoseResponse.status).toBe(422);
    expect(renderedText(await overflowCutHoseResponse.text())).toContain(
      "The combined number of pieces must be between 1 and 9,999.",
    );
    const [fiftyFootAfterOverflow] = runLocalD1<{ piece_count: number }>(
      `SELECT piece_count FROM anonymous_quote_lines
       WHERE id = '${fiftyFootLine?.id ?? ""}'`,
    );
    expect(fiftyFootAfterOverflow?.piece_count).toBe(3);

    const hoseQuoteListResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: quoteCookie },
    });
    const hoseQuoteList = await hoseQuoteListResponse.text();
    const hoseQuoteListText = renderedText(hoseQuoteList);
    expect(hoseQuoteListResponse.status).toBe(200);
    expect(hoseQuoteListText).toContain("Made to order");
    expect(hoseQuoteListText).toContain("50 ft x 3 pieces = 150 total ft");
    expect(hoseQuoteList).toContain("Cutting &amp; Labeling Fee");

    const updateCutHose = new FormData();
    updateCutHose.set("intent", "update-length-hose");
    updateCutHose.set("lineId", fiftyFootLine?.id ?? "");
    updateCutHose.set("pieceCount", "4");
    const updateCutHoseResponse = await fetch(`${origin}/quote-list`, {
      body: updateCutHose,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(updateCutHoseResponse.status).toBe(302);
    const [updatedFiftyFootLine] = runLocalD1<{
      current_estimate_amount: number;
      piece_count: number;
      total_footage: number;
    }>(
      `SELECT piece_count, total_footage, current_estimate_amount
       FROM anonymous_quote_lines WHERE id = '${fiftyFootLine?.id ?? ""}'`,
    );
    expect(updatedFiftyFootLine).toEqual({
      current_estimate_amount: 437,
      piece_count: 4,
      total_footage: 200,
    });

    updateCutHose.set("pieceCount", "10000");
    const invalidPiecesResponse = await fetch(`${origin}/quote-list`, {
      body: updateCutHose,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(invalidPiecesResponse.status).toBe(422);
    expect(await invalidPiecesResponse.text()).toContain(
      "Pieces must be a whole number from 1 to 9,999.",
    );

    const twentyFiveFootLine = hoseLines.find(
      (line) => line.normalized_length_ft === 25,
    );
    const removeCutHose = new FormData();
    removeCutHose.set("intent", "remove");
    removeCutHose.set("lineId", twentyFiveFootLine?.id ?? "");
    const removeCutHoseResponse = await fetch(`${origin}/quote-list`, {
      body: removeCutHose,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(removeCutHoseResponse.status).toBe(302);
    const [remainingCutHoseLines] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}' AND sku = '601R1_001'`,
    );
    expect(remainingCutHoseLines?.count).toBe(1);

    const replacementForm = new FormData();
    replacementForm.set(
      "workbook",
      new File([workbook], "replacement-storefront-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const replacementImportResponse = await fetch(
      `${origin}/admin/catalog/import`,
      { body: replacementForm, method: "POST", redirect: "manual" },
    );
    expect(replacementImportResponse.status).toBe(302);
    const replacementImportId = new URL(
      replacementImportResponse.headers.get("location") ?? "",
      origin,
    ).searchParams.get("import");
    const [replacementDraft] = runLocalD1<{ id: string; version: number }>(
      `SELECT id, version FROM catalog_releases
       WHERE source_import_id = '${replacementImportId}' AND status = 'draft'`,
    );
    const [replacementActive] = runLocalD1<{
      active_generation: number;
      release_id: string;
    }>(
      `SELECT version AS active_generation, release_id
       FROM catalog_active_release WHERE singleton = 1`,
    );
    if (!replacementImportId || !replacementDraft || !replacementActive) {
      throw new Error("Expected replacement Catalog Release");
    }
    runLocalD1(
      `UPDATE catalog_skus
       SET catalog_publication_status = 'Published'
       WHERE import_id = '${replacementImportId}';
       UPDATE catalog_skus
       SET supply_availability = 'available_for_quote'
       WHERE import_id = '${replacementImportId}'
         AND sku = 'ADP_ST_JIC_M_02_NPT_M_02';
       UPDATE catalog_skus
       SET supply_availability = 'discontinued'
       WHERE import_id = '${replacementImportId}'
         AND sku = 'QDC_16028_PLG_04_FNPT_04';
       UPDATE catalog_sales_offers
       SET reference_price_usd = 9.99
       WHERE import_id = '${replacementImportId}'
         AND base_sku = '601R1_001';
       INSERT INTO quote_reference_discounts (
         release_id, sku, line_kind, minimum_quantity,
         discount_percent, record_version, updated_at
       ) VALUES (
         '${replacementDraft.id}', '601R1_001', 'length_based_hose', 1,
         10, 1, CURRENT_TIMESTAMP
       );`,
    );
    const [replacementDraftState] = runLocalD1<{ version: number }>(
      `SELECT version FROM catalog_releases WHERE id = '${replacementDraft.id}'`,
    );
    const replacementPublish = new FormData();
    replacementPublish.set("intent", "publish");
    replacementPublish.set("releaseId", replacementDraft.id);
    replacementPublish.set(
      "expectedDraftVersion",
      String(replacementDraftState?.version),
    );
    replacementPublish.set(
      "expectedActiveGeneration",
      String(replacementActive.active_generation),
    );
    replacementPublish.set(
      "expectedActiveReleaseId",
      replacementActive.release_id,
    );
    const replacementPublishResponse = await fetch(
      `${origin}/admin/catalog/releases`,
      {
        body: replacementPublish,
        headers: {
          "x-request-id": `quote-availability-${replacementDraft.id}`,
        },
        method: "POST",
        redirect: "manual",
      },
    );
    expect(
      replacementPublishResponse.status,
      await replacementPublishResponse.text(),
    ).toBe(302);
    expect(
      runLocalD1Failure(
        `UPDATE quote_reference_discounts
         SET discount_percent = 15, record_version = record_version + 1
         WHERE release_id = '${replacementDraft.id}'
           AND sku = '601R1_001'`,
      ),
    ).toContain("IMMUTABLE_QUOTE_REFERENCE_DISCOUNT");
    expect(
      runLocalD1Failure(
        `INSERT INTO quote_reference_discounts (
           release_id, sku, line_kind, minimum_quantity,
           discount_percent, record_version, updated_at
         ) VALUES (
           '${draft.id}', '601R1_001', 'length_based_hose', 1,
           5, 1, CURRENT_TIMESTAMP
         )`,
      ),
    ).toContain("IMMUTABLE_QUOTE_REFERENCE_DISCOUNT");

    const [retainedHoseBeforeRefresh] = runLocalD1<{
      current_estimate_amount: number;
      cutting_labeling_fee_amount: number;
      cutting_labeling_fee_rate: number;
      estimated_merchandise_amount: number;
      reference_unit_price: number;
    }>(
      `SELECT reference_unit_price, cutting_labeling_fee_rate,
              cutting_labeling_fee_amount, estimated_merchandise_amount,
              current_estimate_amount
       FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}'
         AND line_identity = 'length-hose:601R1_001:50ft'`,
    );
    runLocalD1(
      `UPDATE cutting_labeling_fee_rates
       SET rate_per_piece = 2.25, version = version + 1
       WHERE scope_key = 'series:601R1'`,
    );
    const refreshedQuoteListResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: quoteCookie },
    });
    const refreshedQuoteList = await refreshedQuoteListResponse.text();
    expect(refreshedQuoteListResponse.status).toBe(200);
    expect(refreshedQuoteList).toContain("Estimate updated");
    expect(refreshedQuoteList).toContain("Former merchandise:");
    expect(refreshedQuoteList).toContain("Current merchandise:");
    expect(refreshedQuoteList).toContain("Former service fees:");
    expect(refreshedQuoteList).toContain("Current service fees:");
    expect(refreshedQuoteList).toContain("Current discount:");
    expect(refreshedQuoteList).toContain("temporarily unavailable");
    expect(refreshedQuoteList).toContain("excluded from merchandise subtotal");
    expect(
      runLocalD1<{
        current_estimate_amount: number;
        cutting_labeling_fee_amount: number;
        cutting_labeling_fee_rate: number;
        estimated_merchandise_amount: number;
        reference_unit_price: number;
      }>(
        `SELECT reference_unit_price, cutting_labeling_fee_rate,
                cutting_labeling_fee_amount, estimated_merchandise_amount,
                current_estimate_amount
         FROM anonymous_quote_lines
         WHERE session_id = '${sessionId}'
           AND line_identity = 'length-hose:601R1_001:50ft'`,
      )[0],
    ).toEqual(retainedHoseBeforeRefresh);
    runLocalD1(
      `UPDATE cutting_labeling_fee_rates
       SET rate_per_piece = 1.25, version = version + 1
       WHERE scope_key = 'series:601R1'`,
    );

    const pinnedCompatibilityResponse = await fetch(
      `${origin}/api/configurator/compatible-end-a?release=${draft.id}&hose=601R1_002`,
    );
    expect(pinnedCompatibilityResponse.status).toBe(200);
    const pinnedCompatibility = (await pinnedCompatibilityResponse.json()) as {
      candidates: Array<{ compatibilityId: string }>;
      releaseId: string;
    };
    expect(pinnedCompatibility.releaseId).toBe(draft.id);
    expect(pinnedCompatibility.candidates).toEqual([
      expect.objectContaining({ compatibilityId: "COMP_0011" }),
    ]);

    const replacementCompatibility = (await (
      await fetch(
        `${origin}/api/configurator/compatible-end-a?release=${replacementDraft.id}&hose=601R1_002`,
      )
    ).json()) as { candidates: unknown[] };
    expect(replacementCompatibility.candidates).toEqual([]);

    const legacyImportId = `legacy-hose-import-${crypto.randomUUID()}`;
    const legacyReleaseId = `legacy-hose-release-${crypto.randomUUID()}`;
    const legacySku = `LEGACY_HOSE_${crypto.randomUUID()}`;
    const legacyNow = new Date().toISOString();
    runLocalD1(
      `INSERT INTO catalog_imports (
         id, kind, status, summary_json, error_count, warning_count,
         created_at, completed_at
       ) VALUES (
         '${legacyImportId}', 'workbook', 'completed', '{}', 0, 0,
         '${legacyNow}', '${legacyNow}'
       );
       INSERT INTO catalog_skus (
         id, import_id, sku, source_worksheet, product_type, hose_series,
         catalog_publication_status, rfq_eligibility, technical_data_status,
         supply_availability
       ) VALUES (
         'legacy-hose-sku-${crypto.randomUUID()}', '${legacyImportId}',
         '${legacySku}', '01_胶管主数据', 'hose', 'LEGACY', 'Published',
         'Eligible', 'Complete', 'available_for_quote'
       );
       INSERT INTO catalog_releases (
         id, release_number, status, source_import_id, version, created_at,
         published_at
       ) VALUES (
         '${legacyReleaseId}', 'LEGACY-${legacyReleaseId}', 'superseded',
         '${legacyImportId}', 1, '${legacyNow}', '${legacyNow}'
       );`,
    );
    const supersededBuild = await (
      await fetch(`${origin}/build-a-hose?hose=${legacySku}`)
    ).text();
    expect(supersededBuild).toContain(
      "This hose belongs to an older catalog release.",
    );
    expect(supersededBuild).toContain(legacySku);

    const unavailableUpdateResponse = await fetch(`${origin}/quote-list`, {
      body: update,
      headers: { cookie: quoteCookie },
      method: "POST",
    });
    expect(unavailableUpdateResponse.status).toBe(409);
    expect(await unavailableUpdateResponse.text()).toContain(
      "not currently available",
    );
    const rollingBefore = new Date(Date.now() + 24 * 60 * 60 * 1000);
    runLocalD1(
      `UPDATE anonymous_quote_sessions
       SET expires_at = '${rollingBefore.toISOString()}'
       WHERE id = '${sessionId}'`,
    );
    const rollingResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: quoteCookie },
    });
    expect(rollingResponse.status).toBe(200);
    const [rolledSession] = runLocalD1<{ expires_at: string }>(
      `SELECT expires_at FROM anonymous_quote_sessions WHERE id = '${sessionId}'`,
    );
    expect(new Date(rolledSession?.expires_at ?? 0).getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 60 * 60 * 1000,
    );

    const tamperedCookie = quoteCookie.replace(sessionId, `${sessionId}-other`);
    const tamperedResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: tamperedCookie },
    });
    expect(tamperedResponse.status).toBe(200);
    expect(await tamperedResponse.text()).not.toContain("JIC_F_SW_04_04");

    const staleUpdateResponse = await fetch(`${origin}/quote-list`, {
      body: update,
      headers: { cookie: tamperedCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(staleUpdateResponse.status).toBe(302);
    const recoveredCookie = cookieHeader(staleUpdateResponse);
    const recoveredSessionId = sessionIdFromCookie(recoveredCookie);
    expect(recoveredSessionId).not.toBe(sessionId);
    const [recoveredLineCount] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_lines
       WHERE session_id = '${recoveredSessionId}'`,
    );
    expect(recoveredLineCount?.count).toBe(0);
    const [originalLineAfterRecovery] = runLocalD1<{ quantity: number }>(
      `SELECT quantity FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}' AND id = '${mergedLine?.id ?? ""}'`,
    );
    expect(originalLineAfterRecovery?.quantity).toBe(5);

    const remove = new FormData();
    remove.set("intent", "remove");
    remove.set("lineId", mergedLine?.id ?? "");
    const removeResponse = await fetch(`${origin}/quote-list`, {
      body: remove,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(removeResponse.status).toBe(302);
    const [removedCount] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_lines
       WHERE session_id = '${sessionId}' AND sku = 'JIC_F_SW_04_04'`,
    );
    expect(removedCount?.count).toBe(0);

    runLocalD1(
      `UPDATE anonymous_quote_sessions
       SET expires_at = '2020-01-01T00:00:00.000Z'
       WHERE id = '${sessionId}'`,
    );
    const expiredResponse = await fetch(`${origin}/quote-list`, {
      headers: { cookie: quoteCookie },
    });
    expect(expiredResponse.status).toBe(200);
    expect(await expiredResponse.text()).not.toContain(
      "ADP_ST_JIC_M_02_NPT_M_02",
    );
    const expiredRecoveryAdd = new FormData();
    expiredRecoveryAdd.set("intent", "add");
    expiredRecoveryAdd.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    expiredRecoveryAdd.set("quantity", "1");
    const expiredRecoveryResponse = await fetch(`${origin}/quote-list`, {
      body: expiredRecoveryAdd,
      headers: { cookie: quoteCookie },
      method: "POST",
      redirect: "manual",
    });
    expect(expiredRecoveryResponse.status).toBe(302);
    expect(sessionIdFromCookie(cookieHeader(expiredRecoveryResponse))).not.toBe(
      sessionId,
    );
    const [expiredSessionCount] = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM anonymous_quote_sessions
       WHERE id = '${sessionId}'`,
    );
    expect(expiredSessionCount?.count).toBe(0);

    const unselectedHoseEnd = await (
      await fetch(`${origin}/catalog/hose-ends/jic-37-female-swivel-0-straight`)
    ).text();
    expect(unselectedHoseEnd).toContain("1. Connection Dash");
    expect(unselectedHoseEnd).not.toContain("2. Hose Tail Dash");
    expect(unselectedHoseEnd).toContain("Choose a size to continue.");
    expect(unselectedHoseEnd).not.toContain('data-sku="JIC_F_SW_04_04"');
    expect(unselectedHoseEnd).not.toContain("Technical specifications");
    expect(unselectedHoseEnd).toMatch(/product-quote-command[^>]*disabled/);

    const unavailable = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1?sku=601R1_002`)
    ).text();
    expect(unavailable).toContain("Temporarily Unavailable");
    expect(unavailable).toMatch(/product-quote-command[^>]*disabled/);

    const discontinued = await (
      await fetch(
        `${origin}/catalog/quick-couplers/iso-16028-flat-face-plug-nipple-nptf-female?sku=QDC_16028_PLG_04_FNPT_04`,
      )
    ).text();
    expect(discontinued).toContain("Discontinued");
    expect(discontinued).toMatch(/product-quote-command[^>]*disabled/);

    const mediaFallback = await (
      await fetch(
        `${origin}/catalog/ferrules/601r1-1-wire-braid-other?sku=601R1_1WB_001`,
      )
    ).text();
    expect(mediaFallback).toContain("Technical image pending");

    const hoseVariant = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1?sku=601R1_001`)
    ).text();
    expect(hoseVariant).toContain("Hose Inside Diameter");
    expect(hoseVariant).toContain('data-hose-dash="-3"');
    expect(hoseVariant).toContain("3/16 in");
    expect(hoseVariant).not.toContain("Size / connection variant");

    const unselectedHose = await (
      await fetch(`${origin}/catalog/hydraulic-hose/601r1`)
    ).text();
    expect(unselectedHose).toContain("Hose Inside Diameter");
    expect(unselectedHose).toContain("Choose a size to continue.");
    expect(unselectedHose).not.toContain('data-sku="601R1_001"');
    expect(unselectedHose).not.toContain("Technical specifications");
    expect(unselectedHose).toMatch(/product-quote-command[^>]*disabled/);

    const productResponse = await fetch(
      `${origin}/api/catalog/products/JIC_F_SW_04_04`,
    );
    const productText = await productResponse.text();
    expect(productResponse.status).toBe(200);
    expect(productText).toContain("SAE J514");
    expect(productText).not.toContain("factory_unit_price");
    expect(productText).not.toContain("costBasis");
  }, 300_000);

  it("merges the anonymous Quote List into the verified customer account", async () => {
    const add = new FormData();
    add.set("intent", "add");
    add.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    add.set("quantity", "2");
    const added = await fetch(`${origin}/quote-list`, {
      body: add,
      method: "POST",
      redirect: "manual",
    });
    expect(added.status).toBe(302);
    const anonymousCookie = cookieHeader(added);
    const anonymousSessionId = sessionIdFromCookie(anonymousCookie);

    const requested = await requestEmailOtp({
      cookie: anonymousCookie,
      email: "quote-list-merge@example.com",
      path: "/register",
    });
    if (!requested.challenge) throw new Error("Expected registration OTP");
    const verified = await verifyEmailOtp({
      challengeId: requested.challenge.challengeId,
      code: requested.challenge.code,
      cookie: anonymousCookie,
      path: "/register",
      returnTo: "/quote-list",
    });
    expect(verified.status).toBe(302);
    expect(verified.headers.get("set-cookie")).toMatch(
      /hs_quote_session=;[^,]*Max-Age=0/,
    );
    const customerCookie = cookieHeader(verified);

    const accountList = await fetch(`${origin}/quote-list`, {
      headers: { cookie: customerCookie },
    });
    expect(accountList.status).toBe(200);
    expect(await accountList.text()).toContain("ADP_ST_JIC_M_02_NPT_M_02");
    expect(accountList.headers.get("set-cookie")).toBeNull();
    expect(
      runLocalD1<{
        merged_into_session_id: string;
        retired_at: string;
      }>(
        `SELECT retired_at, merged_into_session_id
         FROM anonymous_quote_sessions WHERE id = '${anonymousSessionId}'`,
      ),
    ).toEqual([
      {
        merged_into_session_id: expect.any(String),
        retired_at: expect.any(String),
      },
    ]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_quote_list_merges
         WHERE source_session_id = '${anonymousSessionId}'`,
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("submits one immutable Individual quote request and clears its list atomically", async () => {
    const anonymousSubmission = new FormData();
    anonymousSubmission.set("intent", "submit_individual_quote_request");
    anonymousSubmission.set("idempotencyKey", crypto.randomUUID());
    anonymousSubmission.set("accuracyConfirmed", "yes");
    anonymousSubmission.set("commercialReviewConfirmed", "yes");
    const unauthenticated = await fetch(`${origin}/quote-list`, {
      body: anonymousSubmission,
      headers: { origin },
      method: "POST",
      redirect: "manual",
    });
    expect(unauthenticated.status).toBe(302);
    expect(unauthenticated.headers.get("location")).toBe(
      "/sign-in?returnTo=%2Fquote-list",
    );

    const requested = await requestEmailOtp({
      email: "individual-request@example.com",
      path: "/register",
    });
    if (!requested.challenge) throw new Error("Expected registration OTP");
    const verified = await verifyEmailOtp({
      challengeId: requested.challenge.challengeId,
      code: requested.challenge.code,
      path: "/register",
      returnTo: "/quote-list",
    });
    const customerCookie = cookieHeader(verified);

    const add = new FormData();
    add.set("intent", "add");
    add.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    add.set("quantity", "1");
    expect(
      (
        await fetch(`${origin}/quote-list`, {
          body: add,
          headers: { cookie: customerCookie },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const quoteListBeforeAddress = await (
      await fetch(`${origin}/quote-list`, {
        headers: { cookie: customerCookie },
      })
    ).text();
    const firstKey = quoteListBeforeAddress.match(
      /name="idempotencyKey"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="idempotencyKey"/,
    );
    const keyBeforeAddress =
      firstKey?.[1] ?? firstKey?.[2] ?? crypto.randomUUID();
    let selectedLineIds: string[] = [];
    const submit = (key: string, acknowledgements = true) => {
      const form = new FormData();
      form.set("intent", "submit_individual_quote_request");
      form.set("idempotencyKey", key);
      for (const lineId of selectedLineIds) {
        form.append("selectedLineId", lineId);
      }
      if (acknowledgements) {
        form.set("accuracyConfirmed", "yes");
        form.set("commercialReviewConfirmed", "yes");
      }
      return fetch(`${origin}/quote-list`, {
        body: form,
        headers: { cookie: customerCookie, origin },
        method: "POST",
        redirect: "manual",
      });
    };

    const invalidIdempotencyKey = await submit("too-short");
    expect(invalidIdempotencyKey.status).toBe(422);
    expect(renderedText(await invalidIdempotencyKey.text())).toContain(
      "Refresh the page and try submitting again",
    );

    const addressMissing = await submit(keyBeforeAddress);
    expect(addressMissing.status).toBe(422);
    expect(renderedText(await addressMissing.text())).toContain(
      "Select a complete delivery address",
    );

    const address = new FormData();
    for (const [name, value] of Object.entries({
      addressLine1: "200 Park Avenue",
      addressLine2: "Suite 900",
      city: "New York",
      countryCode: "US",
      intent: "create_address",
      label: "Main delivery",
      postalCode: "10166",
      recipientEmail: "individual-request@example.com",
      recipientName: "Individual Buyer",
      recipientPhone: "+1 212 555 0144",
      stateProvince: "New York",
    })) {
      address.set(name, value);
    }
    expect(
      (
        await fetch(`${origin}/account?view=addresses`, {
          body: address,
          headers: { cookie: customerCookie, origin },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const organization = new FormData();
    for (const [name, value] of Object.entries({
      intent: "create_organization",
      legalName: "Individual Request Test LLC",
      organizationCountryCode: "US",
      registrationOrTaxId: "",
      tradeName: "Request Test",
    })) {
      organization.set(name, value);
    }
    expect(
      (
        await fetch(`${origin}/account?view=profile`, {
          body: organization,
          headers: { cookie: customerCookie, origin },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    const contexts = runLocalD1<{ id: string; kind: string }>(
      `SELECT c.id, c.kind
       FROM customer_purchasing_contexts c
       LEFT JOIN customer_profiles individual
         ON individual.id = c.individual_profile_id
       LEFT JOIN customer_organization_memberships membership
         ON membership.organization_id = c.organization_id
        AND membership.status = 'active'
       LEFT JOIN customer_profiles member
         ON member.id = membership.profile_id
       WHERE individual.email_normalized = 'individual-request@example.com'
          OR member.email_normalized = 'individual-request@example.com'
       ORDER BY c.kind`,
    );
    const individualContext = contexts.find(
      ({ kind }) => kind === "individual",
    );
    const organizationContext = contexts.find(
      ({ kind }) => kind === "organization",
    );
    if (!individualContext || !organizationContext) {
      throw new Error("Expected Individual and Organization contexts");
    }
    const selectContext = (contextId: string) => {
      const form = new FormData();
      form.set("intent", "select_context");
      form.set("contextId", contextId);
      return fetch(`${origin}/account?view=profile`, {
        body: form,
        headers: { cookie: customerCookie, origin },
        method: "POST",
        redirect: "manual",
      });
    };
    expect((await selectContext(organizationContext.id)).status).toBe(302);
    const organizationSubmission = await submit(crypto.randomUUID());
    expect(organizationSubmission.status).toBe(422);
    expect(renderedText(await organizationSubmission.text())).toContain(
      "Select Individual purchase",
    );
    expect((await selectContext(individualContext.id)).status).toBe(302);

    const [line] = runLocalD1<{ id: string }>(
      `SELECT l.id FROM anonymous_quote_lines l
       INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
       INNER JOIN customer_profiles p ON p.id = s.profile_id
       WHERE p.email_normalized = 'individual-request@example.com'`,
    );
    if (!line) throw new Error("Expected account-owned Quote List line");
    selectedLineIds = [line.id];

    const belowMinimum = await submit(crypto.randomUUID());
    expect(belowMinimum.status).toBe(422);
    expect(renderedText(await belowMinimum.text())).toContain(
      "merchandise subtotal must be at least USD 100.00",
    );

    runLocalD1(
      `UPDATE anonymous_quote_lines
       SET sku = 'TICKET10_UNAVAILABLE', updated_at = CURRENT_TIMESTAMP
       WHERE id = '${line.id}'`,
    );
    const unavailable = await submit(crypto.randomUUID());
    expect(unavailable.status).toBe(422);
    expect(renderedText(await unavailable.text())).toContain(
      "Review the highlighted products before submitting",
    );
    runLocalD1(
      `UPDATE anonymous_quote_lines
       SET sku = 'ADP_ST_JIC_M_02_NPT_M_02', updated_at = CURRENT_TIMESTAMP
       WHERE id = '${line.id}'`,
    );

    const update = new FormData();
    update.set("intent", "update");
    update.set("lineId", line.id);
    update.set("quantity", "100");
    expect(
      (
        await fetch(`${origin}/quote-list`, {
          body: update,
          headers: { cookie: customerCookie },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const unselectedLine = { id: `${line.id}-unselected` };
    runLocalD1(
      `INSERT INTO anonymous_quote_lines
         (id, session_id, line_identity, sku, catalog_release_id, display_name,
          category, quantity, sales_unit, currency, reference_unit_price,
          created_at, updated_at, line_kind, original_length_value,
          original_length_unit, normalized_length_ft, piece_count,
          total_footage, cutting_labeling_fee_rate,
          cutting_labeling_fee_amount, cutting_labeling_fee_scope,
          cutting_labeling_fee_version, estimated_merchandise_amount,
          current_estimate_amount, configured_snapshot_json,
          configured_estimate_inputs_json, configured_unit_estimate_amount)
       SELECT '${unselectedLine.id}', session_id,
              'unselected:' || line_identity, 'TICKET10_UNSELECTED_BLOCKED',
              catalog_release_id, 'Unselected blocked product', category, 1,
              sales_unit, currency, reference_unit_price, created_at,
              CURRENT_TIMESTAMP, line_kind, original_length_value,
              original_length_unit, normalized_length_ft, piece_count,
              total_footage, cutting_labeling_fee_rate,
              cutting_labeling_fee_amount, cutting_labeling_fee_scope,
              cutting_labeling_fee_version, estimated_merchandise_amount,
              current_estimate_amount, configured_snapshot_json,
              configured_estimate_inputs_json, configured_unit_estimate_amount
       FROM anonymous_quote_lines WHERE id = '${line.id}'`,
    );

    const readyHtml = await (
      await fetch(`${origin}/quote-list`, {
        headers: { cookie: customerCookie },
      })
    ).text();
    const readyKeyMatch = readyHtml.match(
      /name="idempotencyKey"[^>]*value="([^"]+)"|value="([^"]+)"[^>]*name="idempotencyKey"/,
    );
    const idempotencyKey = readyKeyMatch?.[1] ?? readyKeyMatch?.[2];
    expect(idempotencyKey).toBeTruthy();
    expect(renderedText(readyHtml)).toContain("Request Quote");
    expect(renderedText(readyHtml)).toContain("Deliver to Main delivery");
    expect(renderedText(readyHtml)).toContain("TICKET10_UNSELECTED_BLOCKED");

    const aboveLimit = new FormData();
    aboveLimit.set("intent", "update");
    aboveLimit.set("lineId", line.id);
    aboveLimit.set("quantity", "9999");
    expect(
      (
        await fetch(`${origin}/quote-list`, {
          body: aboveLimit,
          headers: { cookie: customerCookie },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    const aboveIndividualLimit = await submit(crypto.randomUUID());
    expect(aboveIndividualLimit.status).toBe(422);
    expect(renderedText(await aboveIndividualLimit.text())).toContain(
      "limited to USD 4,500.00",
    );
    update.set("quantity", "100");
    expect(
      (
        await fetch(`${origin}/quote-list`, {
          body: update,
          headers: { cookie: customerCookie },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const missingAcknowledgements = await submit(idempotencyKey ?? "", false);
    expect(missingAcknowledgements.status).toBe(422);
    expect(renderedText(await missingAcknowledgements.text())).toContain(
      "Confirm the request details",
    );

    const submitted = await submit(idempotencyKey ?? "", true);
    expect(submitted.status).toBe(302);
    const confirmationPath = submitted.headers.get("location") ?? "";
    expect(confirmationPath).toMatch(/^\/quote-request\/[^/]+\/confirmation$/);
    const confirmation = await fetch(`${origin}${confirmationPath}`, {
      headers: { cookie: customerCookie },
    });
    const confirmationText = renderedText(await confirmation.text());
    expect(confirmation.status).toBe(200);
    expect(confirmationText).toContain("We have your request");
    expect(confirmationText).toContain("Quote request number");
    expect(confirmationText).toContain("not an order or payment receipt");

    const requestId = confirmationPath.split("/")[2];
    const myQuotes = await fetch(`${origin}/account?view=my-quotes`, {
      headers: { cookie: customerCookie },
    });
    const myQuotesText = renderedText(await myQuotes.text());
    expect(myQuotes.status).toBe(200);
    expect(myQuotesText).toContain("My Quotes");
    expect(myQuotesText).toContain("RFQ Submitted");
    expect(myQuotesText).toContain("Individual purchase");
    expect(myQuotesText).toContain("Seller-managed import handling (DDP)");
    expect(myQuotesText).toContain("View details");

    const quoteDetailPath = `/account/quotes/${requestId}`;
    const quoteDetail = await fetch(`${origin}${quoteDetailPath}`, {
      headers: { cookie: customerCookie },
    });
    const quoteDetailText = renderedText(await quoteDetail.text());
    expect(quoteDetail.status).toBe(200);
    expect(quoteDetailText).toContain("Submitted products");
    expect(quoteDetailText).toContain("ADP_ST_JIC_M_02_NPT_M_02");
    expect(quoteDetailText).toContain("200 Park Avenue");
    expect(quoteDetailText).toContain("Individual purchase");
    expect(quoteDetailText).toContain(
      "not a formal quoted price, PI, payment request or order",
    );

    const orders = await fetch(`${origin}/account?view=orders`, {
      headers: { cookie: customerCookie },
    });
    const ordersText = renderedText(await orders.text());
    expect(orders.status).toBe(200);
    expect(ordersText).toContain("No paid and confirmed orders yet");
    expect(ordersText).not.toContain("QR-20260821");

    const repeated = await submit(idempotencyKey ?? "", true);
    expect(repeated.status).toBe(302);
    expect(repeated.headers.get("location")).toBe(confirmationPath);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_quote_requests r
         INNER JOIN customer_profiles p ON p.id = r.profile_id
         WHERE p.email_normalized = 'individual-request@example.com'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         INNER JOIN customer_profiles p ON p.id = s.profile_id
         WHERE p.email_normalized = 'individual-request@example.com'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      runLocalD1<{ sku: string }>(
        `SELECT l.sku FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         INNER JOIN customer_profiles p ON p.id = s.profile_id
         WHERE p.email_normalized = 'individual-request@example.com'`,
      ),
    ).toEqual([{ sku: "TICKET10_UNSELECTED_BLOCKED" }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         INNER JOIN customer_profiles p ON p.id = s.profile_id
         WHERE p.email_normalized = 'quote-list-merge@example.com'`,
      ),
    ).toEqual([{ count: 1 }]);

    runLocalD1(
      `DELETE FROM anonymous_quote_lines WHERE id = '${unselectedLine.id}'`,
    );
    const emptyList = await submit(crypto.randomUUID());
    expect(emptyList.status).toBe(422);
    expect(renderedText(await emptyList.text())).toContain(
      "Your Quote List is empty",
    );

    const [stored] = runLocalD1<{
      reference_number: string;
      snapshot_json: string;
    }>(
      `SELECT r.reference_number, r.snapshot_json
       FROM customer_quote_requests r
       INNER JOIN customer_profiles p ON p.id = r.profile_id
       WHERE p.email_normalized = 'individual-request@example.com'`,
    );
    expect(stored?.reference_number).toMatch(/^QR-\d{8}-[A-Z0-9-]+$/);
    const storedSnapshot = JSON.parse(stored?.snapshot_json ?? "{}");
    expect(storedSnapshot).toMatchObject({
      acknowledgements: {
        accuracyConfirmed: true,
        commercialReviewConfirmed: true,
        version: "individual-request-v1",
      },
      actor: { email: "individual-request@example.com" },
      amounts: {
        currency: "USD",
        merchandiseSubtotal: expect.any(Number),
        serviceFeeTotal: expect.any(Number),
      },
      destination: {
        addressLine1: "200 Park Avenue",
        addressLine2: "Suite 900",
        city: "New York",
        countryCode: "US",
        label: "Main delivery",
        postalCode: "10166",
        recipientEmail: "individual-request@example.com",
        recipientName: "Individual Buyer",
        recipientPhone: "+1 212 555 0144",
        stateProvince: "New York",
      },
      importResponsibility: {
        fulfillmentTerm: "DDP",
        version: "individual-ddp-v1",
      },
      lines: [
        {
          productSnapshot: {
            category: "adapters",
            familyName: expect.any(String),
            mediaKey: null,
            productType: "adapter",
            releaseId: expect.any(String),
            releaseNumber: expect.any(String),
            specs: expect.arrayContaining([
              {
                label: "Interface 1",
                value: expect.any(String),
              },
            ]),
            variantSelection: null,
          },
          quantity: 100,
          refresh: {
            current: {
              discountAmount: 0,
              discountPercent: 0,
              discountRecordVersion: null,
              discountedMerchandiseAmount: expect.any(Number),
              merchandiseAmount: expect.any(Number),
              serviceFeeAmount: expect.any(Number),
              serviceFeeRate: null,
              serviceFeeRecordVersion: null,
              serviceFeeScope: null,
              totalReferenceAmount: expect.any(Number),
              unitReferencePrice: expect.any(Number),
            },
            currentCatalogRelease: {
              id: expect.any(String),
              number: expect.any(String),
            },
            status: "ready",
          },
          sku: "ADP_ST_JIC_M_02_NPT_M_02",
        },
      ],
      purchasingContext: {
        id: individualContext.id,
        isSelected: true,
        kind: "individual",
      },
      submittedAt: expect.any(String),
      version: 2,
    });
    expect(Date.parse(storedSnapshot.submittedAt)).not.toBeNaN();
    expect(storedSnapshot.amounts.merchandiseSubtotal).toBeGreaterThanOrEqual(
      100,
    );
    const submittedEstimate = storedSnapshot.lines[0].refresh.current;
    expect(submittedEstimate.merchandiseAmount).toBeCloseTo(
      submittedEstimate.unitReferencePrice * 100,
      2,
    );
    expect(submittedEstimate.discountedMerchandiseAmount).toBe(
      storedSnapshot.amounts.merchandiseSubtotal,
    );
    expect(submittedEstimate.totalReferenceAmount).toBe(
      submittedEstimate.merchandiseAmount,
    );
    expect(storedSnapshot.amounts.serviceFeeTotal).toBe(
      submittedEstimate.serviceFeeAmount,
    );

    const otherRequested = await requestEmailOtp({
      email: "individual-request-other@example.com",
      path: "/register",
    });
    if (!otherRequested.challenge) throw new Error("Expected second OTP");
    const otherVerified = await verifyEmailOtp({
      challengeId: otherRequested.challenge.challengeId,
      code: otherRequested.challenge.code,
      path: "/register",
    });
    const otherConfirmation = await fetch(`${origin}${confirmationPath}`, {
      headers: { cookie: cookieHeader(otherVerified) },
    });
    expect(otherConfirmation.status).toBe(404);
    const otherQuoteDetail = await fetch(`${origin}${quoteDetailPath}`, {
      headers: { cookie: cookieHeader(otherVerified) },
    });
    expect(otherQuoteDetail.status).toBe(404);
    const changedIdentifier = await fetch(
      `${origin}/account/quotes/${requestId}-changed`,
      { headers: { cookie: customerCookie } },
    );
    expect(changedIdentifier.status).toBe(404);
    expect(
      runLocalD1Failure(
        `UPDATE customer_quote_requests SET service_fee_total = 99
         WHERE reference_number = '${stored?.reference_number ?? ""}'`,
      ),
    ).toContain("submitted quote requests are immutable");
    expect(
      runLocalD1Failure(
        `DELETE FROM customer_quote_requests
         WHERE reference_number = '${stored?.reference_number ?? ""}'`,
      ),
    ).toContain("submitted quote requests are immutable");

    const rollbackLine = new FormData();
    rollbackLine.set("intent", "add");
    rollbackLine.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
    rollbackLine.set("quantity", "100");
    expect(
      (
        await fetch(`${origin}/quote-list`, {
          body: rollbackLine,
          headers: { cookie: customerCookie },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);
    const [rollbackQuoteLine] = runLocalD1<{ id: string }>(
      `SELECT l.id FROM anonymous_quote_lines l
       INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
       INNER JOIN customer_profiles p ON p.id = s.profile_id
       WHERE p.email_normalized = 'individual-request@example.com'`,
    );
    if (!rollbackQuoteLine)
      throw new Error("Expected rollback Quote List line");
    selectedLineIds = [rollbackQuoteLine.id];
    runLocalD1(
      `CREATE TRIGGER ticket10_force_submission_guard_rejection
       AFTER INSERT ON customer_quote_request_submission_guards
       BEGIN
         DELETE FROM customer_quote_request_submission_guards
         WHERE id = NEW.id;
       END`,
    );
    try {
      const changedDuringSubmission = await submit(crypto.randomUUID(), true);
      expect(changedDuringSubmission.status).toBe(422);
      expect(renderedText(await changedDuringSubmission.text())).toContain(
        "Your Quote List changed while it was being submitted",
      );
      expect(
        runLocalD1<{ count: number }>(
          `SELECT COUNT(*) AS count FROM customer_quote_requests r
           INNER JOIN customer_profiles p ON p.id = r.profile_id
           WHERE p.email_normalized = 'individual-request@example.com'`,
        ),
      ).toEqual([{ count: 1 }]);
      expect(
        runLocalD1<{ count: number }>(
          `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
           INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
           INNER JOIN customer_profiles p ON p.id = s.profile_id
           WHERE p.email_normalized = 'individual-request@example.com'`,
        ),
      ).toEqual([{ count: 1 }]);
    } finally {
      runLocalD1("DROP TRIGGER ticket10_force_submission_guard_rejection");
    }
    runLocalD1(
      `CREATE TRIGGER ticket10_force_quote_list_delete_failure
       BEFORE DELETE ON anonymous_quote_lines
       BEGIN
         SELECT RAISE(ABORT, 'ticket10 forced rollback');
       END`,
    );
    try {
      const rolledBack = await submit(crypto.randomUUID(), true);
      expect(rolledBack.status).toBe(500);
      expect(
        runLocalD1<{ count: number }>(
          `SELECT COUNT(*) AS count FROM customer_quote_requests r
           INNER JOIN customer_profiles p ON p.id = r.profile_id
           WHERE p.email_normalized = 'individual-request@example.com'`,
        ),
      ).toEqual([{ count: 1 }]);
      expect(
        runLocalD1<{ count: number }>(
          `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
           INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
           INNER JOIN customer_profiles p ON p.id = s.profile_id
           WHERE p.email_normalized = 'individual-request@example.com'`,
        ),
      ).toEqual([{ count: 1 }]);
    } finally {
      runLocalD1("DROP TRIGGER ticket10_force_quote_list_delete_failure");
    }
  }, 120_000);

  it("submits business RFQs through the shared atomic command for an active Primary Company Contact", async () => {
    const email = "business-request@example.com";
    const requested = await requestEmailOtp({ email, path: "/register" });
    if (!requested.challenge)
      throw new Error("Expected business registration OTP");
    const verified = await verifyEmailOtp({
      challengeId: requested.challenge.challengeId,
      code: requested.challenge.code,
      path: "/register",
      returnTo: "/quote-list",
    });
    const customerCookie = cookieHeader(verified);

    const address = new FormData();
    for (const [name, value] of Object.entries({
      addressLine1: "350 Fifth Avenue",
      addressLine2: "Floor 21",
      city: "New York",
      countryCode: "US",
      intent: "create_address",
      label: "Business receiving",
      postalCode: "10118",
      recipientEmail: email,
      recipientName: "Business Buyer",
      recipientPhone: "+1 212 555 0199",
      stateProvince: "New York",
    })) {
      address.set(name, value);
    }
    expect(
      (
        await fetch(`${origin}/account?view=addresses`, {
          body: address,
          headers: { cookie: customerCookie, origin },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const organization = new FormData();
    for (const [name, value] of Object.entries({
      intent: "create_organization",
      legalName: "Business Request Test LLC",
      organizationCountryCode: "US",
      registrationOrTaxId: "US-TEST-1100",
      tradeName: "Business Request Test",
    })) {
      organization.set(name, value);
    }
    expect(
      (
        await fetch(`${origin}/account?view=profile`, {
          body: organization,
          headers: { cookie: customerCookie, origin },
          method: "POST",
          redirect: "manual",
        })
      ).status,
    ).toBe(302);

    const [account] = runLocalD1<{
      address_id: string;
      context_id: string;
      membership_id: string;
      organization_id: string;
      profile_id: string;
    }>(
      `SELECT p.id AS profile_id, a.id AS address_id, c.id AS context_id,
              o.id AS organization_id, m.id AS membership_id
       FROM customer_profiles p
       INNER JOIN customer_delivery_addresses a ON a.profile_id = p.id
       INNER JOIN customer_organization_memberships m ON m.profile_id = p.id
       INNER JOIN customer_organizations o ON o.id = m.organization_id
       INNER JOIN customer_purchasing_contexts c ON c.organization_id = o.id
       WHERE p.email_normalized = '${email}'`,
    );
    if (!account) throw new Error("Expected business account records");

    const addLine = async (quantity: number) => {
      const add = new FormData();
      add.set("intent", "add");
      add.set("sku", "ADP_ST_JIC_M_02_NPT_M_02");
      add.set("quantity", String(quantity));
      const response = await fetch(`${origin}/quote-list`, {
        body: add,
        headers: { cookie: customerCookie },
        method: "POST",
        redirect: "manual",
      });
      expect(response.status, renderedText(await response.clone().text())).toBe(
        302,
      );
      const [line] = runLocalD1<{ id: string }>(
        `SELECT l.id FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         WHERE s.profile_id = '${account.profile_id}'
         ORDER BY l.created_at DESC LIMIT 1`,
      );
      if (!line) throw new Error("Expected business Quote List line");
      return line.id;
    };
    const submitOrganization = (lineId: string) => {
      const form = new FormData();
      form.set("intent", "submit_organization_quote_request");
      form.set("idempotencyKey", crypto.randomUUID());
      form.set("selectedLineId", lineId);
      form.set("accuracyConfirmed", "yes");
      form.set("commercialReviewConfirmed", "yes");
      return fetch(`${origin}/quote-list`, {
        body: form,
        headers: { cookie: customerCookie, origin },
        method: "POST",
        redirect: "manual",
      });
    };

    const ddpLineId = await addLine(100);
    const quoteListHtml = await (
      await fetch(`${origin}/quote-list`, {
        headers: { cookie: customerCookie },
      })
    ).text();
    expect(quoteListHtml).toContain(
      'value="submit_organization_quote_request"',
    );
    expect(renderedText(quoteListHtml)).toContain(
      "Purchasing for Business Request Test",
    );
    expect(renderedText(quoteListHtml)).toContain(
      "Legal company: Business Request Test LLC",
    );

    const ownershipCountBefore = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM customer_organization_memberships
       WHERE organization_id = '${account.organization_id}'`,
    )[0]?.count;
    runLocalD1(
      `UPDATE customer_organization_memberships SET role = 'member'
       WHERE id = '${account.membership_id}'`,
    );
    const unauthorizedSelection = new FormData();
    unauthorizedSelection.set("intent", "select_context");
    unauthorizedSelection.set("contextId", account.context_id);
    const selectionResponse = await fetch(`${origin}/account?view=profile`, {
      body: unauthorizedSelection,
      headers: { cookie: customerCookie, origin },
      method: "POST",
      redirect: "manual",
    });
    expect(selectionResponse.status).toBe(404);
    const unauthorizedSubmission = await submitOrganization(ddpLineId);
    expect(unauthorizedSubmission.status).toBe(422);
    expect(renderedText(await unauthorizedSubmission.text())).toContain(
      "Primary Company Contact",
    );
    runLocalD1(
      `UPDATE customer_organization_memberships SET role = 'primary_contact'
       WHERE id = '${account.membership_id}'`,
    );

    runLocalD1(
      `UPDATE customer_organizations SET country_code = 'XX'
       WHERE id = '${account.organization_id}'`,
    );
    const incompleteCompany = await submitOrganization(ddpLineId);
    expect(incompleteCompany.status).toBe(422);
    expect(renderedText(await incompleteCompany.text())).toContain(
      "Complete the selected organization's legal company details",
    );
    runLocalD1(
      `UPDATE customer_organizations SET country_code = 'US'
       WHERE id = '${account.organization_id}'`,
    );

    runLocalD1(
      `UPDATE customer_delivery_addresses SET country_code = 'XX'
       WHERE id = '${account.address_id}'`,
    );
    const incompleteAddress = await submitOrganization(ddpLineId);
    expect(incompleteAddress.status).toBe(422);
    expect(renderedText(await incompleteAddress.text())).toContain(
      "complete every required field",
    );
    runLocalD1(
      `UPDATE customer_delivery_addresses SET country_code = 'US'
       WHERE id = '${account.address_id}'`,
    );

    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_quote_requests
         WHERE profile_id = '${account.profile_id}'`,
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         WHERE s.profile_id = '${account.profile_id}'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM customer_organization_memberships
         WHERE organization_id = '${account.organization_id}'`,
      )[0]?.count,
    ).toBe(ownershipCountBefore);

    const ddpSubmission = await submitOrganization(ddpLineId);
    expect(ddpSubmission.status).toBe(302);
    const ddpConfirmationPath = ddpSubmission.headers.get("location") ?? "";
    const ddpConfirmation = await fetch(`${origin}${ddpConfirmationPath}`, {
      headers: { cookie: customerCookie },
    });
    const ddpConfirmationText = renderedText(await ddpConfirmation.text());
    expect(ddpConfirmation.status).toBe(200);
    expect(ddpConfirmationText).toContain("Business Request Test LLC");
    expect(ddpConfirmationText).toContain("Import handling DDP");

    const dapLineId = await addLine(2_000);
    const dapSubmission = await submitOrganization(dapLineId);
    expect(dapSubmission.status).toBe(302);

    const stored = runLocalD1<{
      fulfillment_term: string;
      id: string;
      purchasing_context_kind: string;
      reference_number: string;
      snapshot_json: string;
    }>(
      `SELECT id, reference_number, purchasing_context_kind,
              fulfillment_term, snapshot_json
       FROM customer_quote_requests
       WHERE profile_id = '${account.profile_id}'
       ORDER BY submitted_at, id`,
    );
    expect(stored).toHaveLength(2);
    expect(
      stored.map(({ fulfillment_term }) => fulfillment_term).sort(),
    ).toEqual(["DAP", "DDP"]);
    for (const row of stored) {
      expect(row.purchasing_context_kind).toBe("organization");
      const snapshot = JSON.parse(row.snapshot_json);
      expect(snapshot).toMatchObject({
        acknowledgements: { version: "organization-request-v1" },
        actor: { email, id: account.profile_id },
        destination: {
          addressLine1: "350 Fifth Avenue",
          city: "New York",
        },
        purchasingContext: {
          countryCode: "US",
          id: account.context_id,
          kind: "organization",
          legalName: "Business Request Test LLC",
          registrationOrTaxId: "US-TEST-1100",
          tradeName: "Business Request Test",
        },
      });
      expect(snapshot.importResponsibility.fulfillmentTerm).toBe(
        row.fulfillment_term,
      );
    }
    const ddpSnapshot = JSON.parse(
      stored.find(({ fulfillment_term }) => fulfillment_term === "DDP")!
        .snapshot_json,
    );
    const dapSnapshot = JSON.parse(
      stored.find(({ fulfillment_term }) => fulfillment_term === "DAP")!
        .snapshot_json,
    );
    expect(ddpSnapshot.amounts.merchandiseSubtotal).toBeGreaterThanOrEqual(100);
    expect(ddpSnapshot.amounts.merchandiseSubtotal).toBeLessThanOrEqual(3_000);
    expect(dapSnapshot.amounts.merchandiseSubtotal).toBeGreaterThan(4_500);
    expect(
      runLocalD1<{ count: number }>(
        `SELECT COUNT(*) AS count FROM anonymous_quote_lines l
         INNER JOIN anonymous_quote_sessions s ON s.id = l.session_id
         WHERE s.profile_id = '${account.profile_id}'`,
      ),
    ).toEqual([{ count: 0 }]);

    const businessMyQuotes = await fetch(`${origin}/account?view=my-quotes`, {
      headers: { cookie: customerCookie },
    });
    const businessMyQuotesText = renderedText(await businessMyQuotes.text());
    expect(businessMyQuotes.status).toBe(200);
    expect(businessMyQuotesText).toContain("Business Request Test LLC");
    expect(businessMyQuotesText).toContain(
      "Seller-managed import handling (DDP)",
    );
    expect(businessMyQuotesText).toContain(
      "Customer-managed import clearance (DAP)",
    );
    for (const request of stored) {
      expect(businessMyQuotesText).toContain(request.reference_number);
    }

    const dapRequest = stored.find(
      ({ fulfillment_term }) => fulfillment_term === "DAP",
    );
    if (!dapRequest) throw new Error("Expected DAP business request");
    const businessDetail = await fetch(
      `${origin}/account/quotes/${dapRequest.id}`,
      { headers: { cookie: customerCookie } },
    );
    const businessDetailText = renderedText(await businessDetail.text());
    expect(businessDetail.status).toBe(200);
    expect(businessDetailText).toContain("Business Request Test LLC");
    expect(businessDetailText).toContain(
      "Customer-managed import clearance (DAP)",
    );
    expect(businessDetailText).toContain("350 Fifth Avenue");

    const outsiderRequested = await requestEmailOtp({
      email: "business-request-outsider@example.com",
      path: "/register",
    });
    if (!outsiderRequested.challenge)
      throw new Error("Expected outsider registration OTP");
    const outsiderVerified = await verifyEmailOtp({
      challengeId: outsiderRequested.challenge.challengeId,
      code: outsiderRequested.challenge.code,
      path: "/register",
    });
    const outsiderDetail = await fetch(
      `${origin}/account/quotes/${dapRequest.id}`,
      { headers: { cookie: cookieHeader(outsiderVerified) } },
    );
    expect(outsiderDetail.status).toBe(404);
  }, 120_000);

  it("reviews immutable RFQ snapshots in the Admin queue", async () => {
    const snapshot = {
      acknowledgements: {
        accuracyConfirmed: true,
        commercialReviewConfirmed: true,
        version: "organization-request-v1",
      },
      actor: {
        email: "admin-review-buyer@example.com",
        fullName: "Admin Review Buyer",
        phoneNumber: "+1 212 555 0128",
        verifiedAt: "2026-09-03T02:55:00.000Z",
      },
      amounts: {
        currency: "USD",
        merchandiseSubtotal: 432.1,
        serviceFeeTotal: 12.5,
      },
      destination: {
        addressLine1: "100 Broadway",
        addressLine2: "Receiving Dock 4",
        city: "New York",
        countryCode: "US",
        label: "Main receiving",
        postalCode: "10005",
        recipientEmail: "admin-review-buyer@example.com",
        recipientName: "Admin Review Buyer",
        recipientPhone: "+1 212 555 0128",
        stateProvince: "NY",
      },
      importResponsibility: {
        fulfillmentTerm: "DDP",
        version: "individual-ddp-v1",
      },
      lines: [
        {
          catalogReleaseId: "release-ticket49",
          category: "adapters",
          currency: "USD",
          displayName: "JIC Straight Adapter",
          id: "line-ticket49-standard",
          lineKind: "standard",
          productSnapshot: {
            category: "adapters",
            familyName: "Straight JIC to NPT Adapter",
            mediaKey: null,
            productType: "adapter",
            releaseId: "release-ticket49",
            releaseNumber: "CAT-2026-09",
            specs: [
              { label: "Interface 1", value: "JIC 37°" },
              { label: "Size 1", value: "-4" },
              { label: "Interface 2", value: "NPT" },
              { label: "Size 2", value: "1/4-18" },
            ],
            variantSelection: null,
          },
          quantity: 2,
          referenceUnitPrice: 8.25,
          salesUnit: "piece",
          sku: "ADP-TICKET49",
        },
        {
          catalogReleaseId: "release-ticket49",
          category: "hydraulic-hose",
          currency: "USD",
          cuttingLabelingFeeAmount: 4,
          cuttingLabelingFeeRate: 2,
          displayName: "601R1 Hydraulic Hose",
          id: "line-ticket49-length-hose",
          lengthOrder: {
            normalizedLengthFt: 2.5,
            originalLengthUnit: "in",
            originalLengthValue: 30,
            pieceCount: 2,
            totalFootage: 5,
          },
          lineKind: "length_based_hose",
          productSnapshot: {
            category: "hydraulic-hose",
            familyName: "601R1 Hydraulic Hose",
            mediaKey: "601R1",
            productType: "hose",
            releaseId: "release-ticket49",
            releaseNumber: "CAT-2026-09",
            specs: [
              { label: "Hose dash", value: "-4" },
              { label: "Nominal ID", value: "0.25 in" },
              { label: "Working pressure", value: "225 bar" },
            ],
            variantSelection: {
              dash: "-4",
              equivalentStandard: "EN 853 1SN",
              hoseSeries: "601R1",
              kind: "hose",
              nominalIdIn: 0.25,
              performance: {
                temperatureMaxC: 100,
                temperatureMinC: -40,
                workingBar: 225,
                workingPsi: 3260,
              },
              primaryStandard: "SAE 100R1AT",
              reinforcement: "one-wire braid",
            },
          },
          quantity: 2,
          referenceUnitPrice: 3.5,
          salesUnit: "piece",
          sku: "601R1_004",
        },
        {
          catalogReleaseId: "release-ticket49",
          category: "hydraulic-hose",
          configuredAssembly: {
            estimateBasis: {
              catalogReleaseId: "release-ticket49",
              protectionRecordVersion: 4,
              scheduleRecordVersion: 7,
            },
            snapshot: {
              configuration: {
                applicationRequirements: {
                  fluidMedium: "Hydraulic oil",
                  maximumWorkingPressure: {
                    originalUnit: "psi",
                    originalValue: 3000,
                  },
                  reviewReasons: ["Customer selected Not Sure for temperature"],
                },
                catalogRelease: {
                  id: "release-ticket49",
                  number: "CAT-2026-09",
                },
                clocking: {
                  convention: {
                    code: "M08",
                    recordVersion: 3,
                    rendererVersion: "clocking-v2",
                  },
                  standardToleranceDegrees: 3,
                  status: "specified",
                  targetDisplay: "090",
                },
                endA: {
                  assemblyWorkingBar: 210,
                  compatibilityId: "compat-a-ticket49",
                  ferrule: {
                    hoseConstruction: "one-wire braid",
                    hoseTailDash: "-6",
                    series: "00110",
                    skiveRequirement: "non-skive",
                    sku: "FERRULE-A-TICKET49",
                  },
                  hoseEnd: {
                    angle: "0°",
                    connectionDash: "-6",
                    connectionStandard: "JIC 37°",
                    displayName: "JIC Female Swivel Straight",
                    hoseTailDash: "-6",
                    sealingForm: "37° flare",
                    sku: "END-A-TICKET49",
                    thread: "9/16-18 UNF",
                  },
                },
                endB: {
                  assemblyWorkingBar: 210,
                  compatibilityId: "compat-b-ticket49",
                  ferrule: {
                    hoseConstruction: "one-wire braid",
                    hoseTailDash: "-6",
                    series: "00110",
                    skiveRequirement: "non-skive",
                    sku: "FERRULE-B-TICKET49",
                  },
                  hoseEnd: {
                    angle: "90°",
                    connectionDash: "-6",
                    connectionStandard: "BSPP",
                    displayName: "BSPP Female Swivel 90°",
                    hoseTailDash: "-6",
                    sealingForm: "bonded seal",
                    sku: "END-B-TICKET49",
                    thread: "G 3/8-19",
                  },
                },
                finishedLength: {
                  canonicalMm: "762.000",
                  manualReviewReasons: [],
                  originalUnit: "in",
                  originalValue: 30,
                  path: "reference_quote",
                  tolerance: {
                    display: "±3/16 in",
                    scheduleVersion: 2,
                  },
                },
                hose: {
                  dash: "-6",
                  equivalentStandard: "EN 853 1SN",
                  familyName: "601R1 Hydraulic Hose",
                  mediaKey: "601R1",
                  nominalIdIn: 0.375,
                  performance: {
                    temperatureMaxC: 100,
                    temperatureMinC: -40,
                    workingBar: 180,
                    workingPsi: 2610,
                  },
                  primaryStandard: "SAE 100R1AT",
                  reinforcement: "one-wire braid",
                  series: "601R1",
                  sku: "601R1_004",
                },
                installedProtection: {
                  code: "NYLON",
                  publicName: "Nylon Protective Sleeving",
                  recordVersion: 4,
                },
                measurementSelection: {
                  diagram: {
                    assetVersion: 5,
                    overlayVersion: "overlay-v3",
                  },
                  method: {
                    code: "M04",
                    displayName: "Straight to 90 degree elbow",
                    recordVersion: 6,
                  },
                  state: "selected",
                },
              },
              review: {
                issues: [
                  {
                    code: "APPLICATION-NOT-SURE",
                    kind: "technical_review",
                    message: "Confirm application temperature with customer.",
                  },
                ],
                outcome: "technical_review",
              },
              sourceCatalogRelease: {
                id: "release-ticket49",
                number: "CAT-2026-09",
              },
            },
          },
          currency: "USD",
          displayName: "601R1 Hydraulic Hose Assembly",
          id: "line-ticket49-assembly",
          lineKind: "configured_assembly",
          quantity: 3,
          referenceUnitPrice: 95.2,
          salesUnit: "assembly",
          sku: "601R1_004",
        },
      ],
      purchasingContext: {
        id: "context-ticket49",
        isSelected: true,
        kind: "individual",
      },
      submittedAt: "2026-09-03T03:00:00.000Z",
      version: 2,
    };
    const requestId = "ticket49-admin-review";
    runLocalD1(
      `INSERT INTO customer_quote_requests
         (id, reference_number, profile_id, purchasing_context_id,
          source_session_id, source_session_version, source_address_id,
          purchasing_context_kind, fulfillment_term, currency,
          merchandise_subtotal, service_fee_total, idempotency_key,
          snapshot_json, submitted_at)
       SELECT ${sqlText(requestId)}, 'QR-TICKET49-ADMIN', profile_id,
              purchasing_context_id, source_session_id, source_session_version,
              source_address_id, 'individual', 'DDP', 'USD', 432.1, 12.5,
              'ticket49-admin-review-idempotency', ${sqlText(JSON.stringify(snapshot))},
              '2026-09-03T03:00:00.000Z'
       FROM customer_quote_requests
       ORDER BY submitted_at LIMIT 1`,
    );

    const queueResponse = await fetch(
      `${origin}/admin/quotes?technical=required&sort=technical_first`,
    );
    const queueHtml = await queueResponse.text();
    const queueText = renderedText(queueHtml);
    expect(queueResponse.status).toBe(200);
    expect(queueText).toContain("RFQ 审核队列");
    expect(queueText).toContain("QR-TICKET49-ADMIN");
    expect(queueText).toContain("Admin Review Buyer");
    expect(queueText).toContain("New York, NY, 10005, US");
    expect(queueText).toContain("$432.10");
    expect(queueText).toContain("需要技术审核");
    expect(queueText).toContain("2026-09-03 11:00 北京时间");
    expect(queueHtml).toContain("/images/catalog/hose/601R1-structure.jpg");

    const before = runLocalD1<{ snapshot_json: string }>(
      `SELECT snapshot_json FROM customer_quote_requests WHERE id = ${sqlText(requestId)}`,
    );
    const detailResponse = await fetch(`${origin}/admin/quotes/${requestId}`);
    const detailText = renderedText(await detailResponse.text());
    expect(detailResponse.status).toBe(200);
    for (const expected of [
      "standard",
      "length_based_hose",
      "configured_assembly",
      "ADP-TICKET49",
      "产品参数（提交时快照）",
      "版本 2 · 含产品参数快照",
      "胶管内径（Hose Inside Diameter）",
      "0.25 in",
      "30 in",
      "FERRULE-A-TICKET49",
      "FERRULE-B-TICKET49",
      "M04",
      "M08",
      "090° clockwise",
      "Nylon Protective Sleeving",
      "CAT-2026-09",
      "100 Broadway",
      "Receiving Dock 4",
      "2026-09-03 10:55 北京时间",
      "2026-09-03 11:00 北京时间",
      "Confirm application temperature with customer.",
      "信息准确",
      "DDP",
    ]) {
      expect(detailText).toContain(expected);
    }

    const writeAttempt = await fetch(`${origin}/admin/quotes/${requestId}`, {
      method: "POST",
    });
    expect(writeAttempt.status).toBe(405);
    expect(
      runLocalD1<{ snapshot_json: string }>(
        `SELECT snapshot_json FROM customer_quote_requests WHERE id = ${sqlText(requestId)}`,
      ),
    ).toEqual(before);

    runLocalD1(
      `INSERT INTO customer_quote_requests
         (id, reference_number, profile_id, purchasing_context_id,
          source_session_id, source_session_version, source_address_id,
          purchasing_context_kind, fulfillment_term, currency,
          merchandise_subtotal, service_fee_total, idempotency_key,
          snapshot_json, submitted_at)
       SELECT 'ticket49-legacy', 'QR-TICKET49-LEGACY', profile_id,
              purchasing_context_id, source_session_id, source_session_version,
              source_address_id, purchasing_context_kind, fulfillment_term,
              currency, merchandise_subtotal, service_fee_total,
              'ticket49-legacy-idempotency', '{"version":1}',
              '2026-09-02T03:00:00.000Z'
       FROM customer_quote_requests
       ORDER BY submitted_at LIMIT 1`,
    );
    const legacyQueue = renderedText(
      await (
        await fetch(`${origin}/admin/quotes?technical=not_recorded`)
      ).text(),
    );
    expect(legacyQueue).toContain("QR-TICKET49-LEGACY");
    expect(legacyQueue).toContain("快照未记录");
    const legacyDetail = await fetch(`${origin}/admin/quotes/ticket49-legacy`);
    expect(legacyDetail.status).toBe(200);
    const legacyDetailText = renderedText(await legacyDetail.text());
    expect(legacyDetailText).toContain("快照未记录");
    expect(legacyDetailText).toContain("版本 1 · 旧快照（未保存产品参数）");
  }, 60_000);

  it("does not expose standalone email draft persistence", async () => {
    const saveResponse = await fetch(`${origin}/api/configurator/save-draft`, {
      body: new FormData(),
      method: "POST",
    });
    expect(saveResponse.status).toBe(404);

    const verificationResponse = await fetch(
      `${origin}/verify-configuration-email?token=obsolete`,
    );
    expect(verificationResponse.status).toBe(404);

    const emailRecoveryResponse = await fetch(
      `${origin}/api/configurator/saved-configurations?email=draft.owner%40example.com`,
    );
    expect(emailRecoveryResponse.status).toBe(404);
    expect(
      runLocalD1<{ name: string }>(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'pending_configuration_%'`,
      ),
    ).toEqual([]);
    expect(
      runLocalD1<{ name: string }>(
        "PRAGMA table_info(customer_saved_configurations)",
      ).map((column) => column.name),
    ).not.toContain("email");
  }, 30_000);

  it("keeps a blocking workbook error out of draft releases", async () => {
    const activeBefore = runLocalD1<{ id: string }>(
      "SELECT id FROM catalog_releases WHERE status = 'published' ORDER BY id",
    );

    const source = await readFile(
      "test/fixtures/catalog-import/hose-product-data-collection-template-length-ordering.xlsx",
    );
    const workbook = XLSX.read(source, { type: "buffer" });
    const compatibility = workbook.Sheets["04_兼容压接"];
    compatibility.C5.v = "UNKNOWN_HOSE";
    const invalidWorkbook = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    });
    const form = new FormData();
    form.set(
      "workbook",
      new File([invalidWorkbook], "invalid-product-data.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const importResponse = await fetch(`${origin}/admin/catalog/import`, {
      body: form,
      method: "POST",
      redirect: "manual",
    });
    expect(importResponse.status).toBe(302);
    const importLocation = importResponse.headers.get("location");
    expect(importLocation).toMatch(/^\/admin\/catalog\/import\?import=/);
    const failedImportId = new URL(
      importLocation ?? "",
      origin,
    ).searchParams.get("import");
    expect(failedImportId).toBeTruthy();

    const reviewResponse = await fetch(`${origin}${importLocation}`);
    const review = await reviewResponse.text();
    expect(reviewResponse.status).toBe(200);
    expect(review).toContain("Import blocked");
    expect(review).toContain("Not created");
    expect(review).toContain("UNKNOWN_HOSE");
    expect(review).toContain("does not exist in 01_胶管主数据");
    expect(review).not.toContain("Draft release created");

    const activeAfter = runLocalD1<{ id: string }>(
      "SELECT id FROM catalog_releases WHERE status = 'published' ORDER BY id",
    );
    const failedDrafts = runLocalD1<{ count: number }>(
      `SELECT COUNT(*) AS count FROM catalog_releases
       WHERE source_import_id = '${failedImportId}'`,
    );
    expect(activeAfter).toEqual(activeBefore);
    expect(failedDrafts).toEqual([{ count: 0 }]);
  });
});
