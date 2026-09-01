import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("account detail responsive navigation", () => {
  it("keeps the complete account menu in the sidebar without clipping", () => {
    const css = readFileSync("app/styles/app.css", "utf8");
    const navigation = css.match(/\.account-detail-navigation\s*\{([^}]*)\}/s);
    const links = css.match(/\.account-detail-navigation a\s*\{([^}]*)\}/s);

    expect(navigation?.[1]).toContain("display: grid");
    expect(navigation?.[1]).toContain("min-width: 0");
    expect(links?.[1]).toContain("width: 100%");
    expect(links?.[1]).toContain("min-height: 44px");
  });
});
