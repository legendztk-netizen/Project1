import { describe, expect, it } from "vitest";

import { robotsTxt } from "../app/modules/storefront/domain/robots";

const production = [
  "User-agent: *",
  "Allow: /",
  "",
  "Sitemap: https://customhoseco.com/sitemap.xml",
  "",
].join("\n");

describe("storefront robots.txt", () => {
  it("allows every crawler and points at the sitemap", () => {
    expect(robotsTxt("https://customhoseco.com")).toBe(production);
  });

  it("falls back to the production origin and never doubles a slash", () => {
    expect(robotsTxt(undefined)).toBe(production);
    expect(robotsTxt("  ")).toBe(production);
    expect(robotsTxt("https://customhoseco.com//")).toBe(production);
  });
});
