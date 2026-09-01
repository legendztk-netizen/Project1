import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("account detail responsive navigation", () => {
  it("keeps the complete secondary menu horizontally reachable on narrow screens", () => {
    const css = readFileSync("app/styles/app.css", "utf8");
    const navigation = css.match(/\.account-detail-navigation\s*\{([^}]*)\}/s);
    const links = css.match(/\.account-detail-navigation a\s*\{([^}]*)\}/s);

    expect(navigation?.[1]).toContain("overflow-x: auto");
    expect(navigation?.[1]).toContain("scroll-snap-type: inline proximity");
    expect(links?.[1]).toContain("flex: 0 0 auto");
    expect(links?.[1]).toContain("scroll-snap-align: start");
  });
});
