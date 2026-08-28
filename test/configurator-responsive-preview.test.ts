import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../app/modules/storefront/styles/configurator.css", import.meta.url),
  "utf8",
);

describe("configurator live preview responsive contract", () => {
  it("keeps a stable scalable schematic on desktop", () => {
    expect(stylesheet).toContain("aspect-ratio: 960 / 350");
    expect(stylesheet).toContain("max-height: calc(100vh - 36px)");
    expect(stylesheet).not.toContain("vector-effect: non-scaling-stroke");
  });

  it("uses a separate mobile preview control and reserves Clocking dock space", () => {
    expect(stylesheet).toContain("@media (max-width: 760px)");
    expect(stylesheet).toContain(
      '.configurator-summary[data-mobile-open="true"]',
    );
    expect(stylesheet).toContain(
      '.mobile-assembly-preview-toggle[data-current-stage="clocking"]',
    );
    expect(stylesheet).toContain(
      '.configurator-summary[data-current-stage="clocking"]',
    );
  });
});
