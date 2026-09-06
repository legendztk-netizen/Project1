// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  AssemblyImpactPanel,
  PublicationErrors,
  PublicationPreviewPanel,
} from "../app/modules/admin/routes/catalog-review";
import type { CatalogPublicationPreview } from "../app/modules/catalog/domain/catalog-publication";
import type { CatalogAssemblyImpact } from "../app/modules/catalog/infrastructure/d1-catalog-assembly-impact-repository";

afterEach(cleanup);

function impact(status: "current" | "stale"): CatalogAssemblyImpact {
  return {
    activeGeneration: 1,
    affectedSeries: ["SERIES-A", "SERIES-B"],
    baselineReleaseId: "active-release",
    calculatedAt: "2026-09-04T08:00:00.000Z",
    calculatedBy: "owner-1",
    inputFingerprint: "impact-v1",
    releaseId: "draft-release",
    sourceChanges: [],
    stale: status === "stale",
    status,
  };
}

describe("Assembly impact review panel", () => {
  function renderPanel(status: "current" | "stale") {
    const router = createMemoryRouter(
      [
        {
          element: (
            <AssemblyImpactPanel
              busy={false}
              impact={impact(status)}
              requestCorrelationId="prepare-operation-1"
            />
          ),
          path: "/admin/catalog/review",
        },
      ],
      { initialEntries: ["/admin/catalog/review"] },
    );
    render(<RouterProvider router={router} />);
  }

  it("validates, updates assembly data, and publishes in one action", () => {
    renderPanel("stale");
    expect(
      screen.getByRole("button", {
        name: "Validate, Update Assembly Data, and Publish / 校验、更新总成并发布",
      }),
    ).toBeTruthy();
    expect(screen.getByText("SERIES-A")).toBeTruthy();
    expect(screen.getByText("SERIES-B")).toBeTruthy();
    expect(document.querySelector('[name="releaseId"]')).toHaveProperty(
      "value",
      "draft-release",
    );
    expect(document.querySelector('[name="intent"]')).toHaveProperty(
      "value",
      "publish_catalog",
    );
  });

  it("keeps the combined publication action available when assembly data is current", () => {
    renderPanel("current");
    expect(screen.getByText("总成数据已是最新")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Validate, Update Assembly Data, and Publish / 校验、更新总成并发布",
      }),
    ).toBeTruthy();
  });

  it("shows additions, changes, and removals for every publication domain", () => {
    const preview = {
      activeGeneration: 1,
      activeRelease: null,
      additions: [],
      affectedSeries: ["SERIES-A"],
      assemblyState: {
        derivedCombinationCount: 1,
        derivedSeriesCount: 1,
        generationId: "generation-1",
        inputFingerprint: "fingerprint-1",
      },
      blockers: [],
      changes: [],
      deactivations: [],
      derivedCombinations: {
        additions: ["ASSEMBLY-ADD"],
        changes: ["ASSEMBLY-CHANGE"],
        removals: ["ASSEMBLY-REMOVE"],
      },
      draftRelease: {
        createdAt: "2026-09-05T00:00:00.000Z",
        id: "draft-release",
        releaseNumber: "DRAFT-1",
        sourceImportId: "draft-import",
        version: 1,
      },
      images: {
        additions: ["IMAGE-ADD"],
        changes: ["IMAGE-CHANGE"],
        removals: ["IMAGE-REMOVE"],
      },
      prices: {
        additions: ["PRICE-ADD"],
        changes: ["PRICE-CHANGE"],
        removals: ["PRICE-REMOVE"],
      },
      products: {
        additions: ["PRODUCT-ADD"],
        changes: ["PRODUCT-CHANGE"],
        removals: ["PRODUCT-REMOVE"],
      },
      relationships: {
        additions: ["RELATIONSHIP-ADD"],
        changes: ["RELATIONSHIP-CHANGE"],
        removals: ["RELATIONSHIP-REMOVE"],
      },
      warnings: [],
    } satisfies CatalogPublicationPreview;

    render(<PublicationPreviewPanel preview={preview} />);

    for (const value of [
      "PRODUCT-REMOVE",
      "PRICE-CHANGE",
      "IMAGE-ADD",
      "RELATIONSHIP-REMOVE",
      "ASSEMBLY-CHANGE",
      "SERIES-A",
    ]) {
      expect(screen.getByText(value)).toBeTruthy();
    }
  });

  it("renders publication blockers in English and Simplified Chinese", () => {
    render(
      <PublicationErrors
        findings={[
          {
            code: "invalid_retail_currency",
            message:
              "1 publishable SKU does not use USD retail pricing: TEST-1. / 1 个待发布 SKU 的零售价格币种不是 USD。",
          },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("publishable SKU");
    expect(alert.textContent).toContain("零售价格币种不是 USD");
    expect(alert.textContent).toContain("TEST-1");
  });
});
