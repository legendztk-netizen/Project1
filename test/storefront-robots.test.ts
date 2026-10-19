import { describe, expect, it } from "vitest";

import {
  adminRobotsTxt,
  isAdminHost,
  robotsTxt,
  storefrontNoindex,
} from "../app/modules/storefront/domain/robots";

const production = [
  "User-agent: *",
  "Allow: /",
  "",
  "Sitemap: https://customhoseco.com/sitemap.xml",
  "",
].join("\n");
const adminOrigin = "https://admin.customhoseco.com";
const noindex = (url: string) => storefrontNoindex(new URL(url), adminOrigin);

describe("storefront robots.txt", () => {
  it("allows every crawler and points at the sitemap", () => {
    expect(robotsTxt("https://customhoseco.com")).toBe(production);
  });

  it("falls back to the production origin and never doubles a slash", () => {
    expect(robotsTxt(undefined)).toBe(production);
    expect(robotsTxt("  ")).toBe(production);
    expect(robotsTxt("https://customhoseco.com//")).toBe(production);
  });

  it("disallows everything on the admin host", () => {
    expect(adminRobotsTxt).toBe("User-agent: *\nDisallow: /\n");
  });

  it("recognises the admin host whatever the scheme or port", () => {
    for (const url of [
      "https://admin.customhoseco.com/robots.txt",
      "http://admin.customhoseco.com/robots.txt",
    ]) {
      expect(isAdminHost(new URL(url), adminOrigin)).toBe(true);
    }
    expect(
      isAdminHost(
        new URL("http://admin.localhost:5174/"),
        "http://admin.localhost:5173",
      ),
    ).toBe(true);
    expect(
      isAdminHost(new URL("https://customhoseco.com/robots.txt"), adminOrigin),
    ).toBe(false);
  });
});

describe("storefront noindex", () => {
  it("keeps sign-in, registration, password reset and Quote List pages out of search on every host", () => {
    for (const path of [
      "/sign-in",
      "/register",
      "/quote-list",
      "/forgot-password",
      "/sign-in/",
      "/Quote-List",
    ]) {
      expect(noindex(`https://customhoseco.com${path}`)).toBe(true);
      expect(noindex(`https://admin.customhoseco.com${path}`)).toBe(true);
    }
  });

  it("leaves the main storefront indexable", () => {
    for (const path of [
      "/",
      "/catalog",
      "/catalog/hose-ends",
      "/catalog/hose-ends/jic-female-swivel-0-straight",
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/policies/returns",
      "/policies/privacy",
    ]) {
      expect(noindex(`https://customhoseco.com${path}`)).toBe(false);
    }
  });

  it("marks every storefront page the admin host duplicates", () => {
    for (const path of [
      "/",
      "/catalog",
      "/catalog/",
      "/catalog/hose-ends",
      "/catalog/hose-ends/jic-female-swivel-0-straight",
      "/build-a-hose",
      "/assembly-measurement-guide",
      "/policies/returns",
      "/policies/privacy",
    ]) {
      expect(noindex(`https://admin.customhoseco.com${path}`)).toBe(true);
    }
  });

  it("never marks admin pages, which answer 401 or a sign-in form", () => {
    for (const path of ["/admin", "/admin/login", "/admin/quotes"]) {
      expect(noindex(`https://admin.customhoseco.com${path}`)).toBe(false);
    }
  });
});
