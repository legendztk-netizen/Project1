import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(
  new URL("../app/modules/storefront/styles/configurator.css", import.meta.url),
  "utf8",
);
const dockSourcePaths = [
  "../app/modules/storefront/routes/build-a-hose.tsx",
  "../app/modules/storefront/ui/assembly-review-stage.tsx",
  "../app/modules/storefront/ui/clocking-stage.tsx",
  "../app/modules/storefront/ui/finished-length-stage.tsx",
  "../app/modules/storefront/ui/protection-application-stage.tsx",
];

describe("configurator live preview responsive contract", () => {
  it("keeps a stable scalable schematic on desktop", () => {
    expect(stylesheet).toContain("aspect-ratio: 960 / 350");
    expect(stylesheet).toContain("max-height: calc(100vh - 36px)");
    expect(stylesheet).toContain("@media (min-width: 1061px)");
    expect(stylesheet).toContain("grid-template-columns: minmax(0, 1.35fr)");
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

  it("keeps every fixed action dock inside the interactive desktop column", () => {
    for (const sourcePath of dockSourcePaths) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), "utf8");
      expect(source).toContain('className="configurator-action-dock-buttons"');
    }
  });

  it("keeps the exit warning above preview and action controls at every width", () => {
    expect(stylesheet).toContain(".unsaved-draft-backdrop {");
    expect(stylesheet).toContain("z-index: 100");
    expect(stylesheet).toContain("max-height: calc(100vh - 48px)");
    expect(stylesheet).toContain("max-height: calc(100vh - 24px)");
    expect(stylesheet).toContain(".unsaved-draft-actions");
  });
});
