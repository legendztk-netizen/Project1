import { describe, expect, it } from "vitest";

import { connectionSizeLabel } from "../app/modules/storefront/domain/variant-label";

describe("connection size label", () => {
  it("shows the thread, or the nominal size where a connection has none", () => {
    expect(connectionSizeLabel("G 3/8-19", "-6")).toBe("G 3/8-19");
    expect(connectionSizeLabel("N/A (Caterpillar flange)", "-24")).toBe(
      "1 1/2 in",
    );
    expect(connectionSizeLabel("N/A (weld end)", "-5")).toBe("5/16 in");
    expect(connectionSizeLabel(null, "-12")).toBe("3/4 in");
    expect(connectionSizeLabel("n/a", null)).toBeNull();
  });
});
