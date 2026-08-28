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

  it("uses a separate mobile preview control above the shared action dock", () => {
    expect(stylesheet).toContain("@media (max-width: 760px)");
    expect(stylesheet).toContain(
      '.configurator-summary[data-mobile-open="true"]',
    );
    expect(stylesheet).toContain(
      "bottom: calc(82px + env(safe-area-inset-bottom))",
    );
    expect(stylesheet).toContain("bottom: 148px");
    expect(stylesheet).toContain(
      ".configurator-action-dock .configurator-back",
    );
    expect(stylesheet).not.toContain(
      '.mobile-assembly-preview-toggle[data-current-stage="clocking"]',
    );
  });
});
