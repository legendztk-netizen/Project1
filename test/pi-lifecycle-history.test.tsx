// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import {
  PiLifecycleHistory,
  type PiLifecycleHistoryItem,
} from "../app/modules/proforma-invoice/ui/pi-lifecycle-history";
import { publicPiLifecycle } from "../app/modules/proforma-invoice/domain/pi-lifecycle";

afterEach(cleanup);
function record(
  state: "current" | "expired" | "accepted" | "superseded",
  awaitingReplacement = false,
): PiLifecycleHistoryItem {
  const target = {
    piId: state,
    documentVersion: 1,
    snapshotHash: "a".repeat(64),
  };
  const lifecycle = publicPiLifecycle(
    {
      ...target,
      requestId: "request",
      quoteRevisionId: "quote",
      totalCents: 12300,
      issuedAt: "2026-09-14T10:00:00.000Z",
      validUntil: "2026-09-28T10:00:00.000Z",
      acceptance:
        state === "accepted" || state === "superseded"
          ? {
              ...target,
              id: "acceptance",
              acceptedAt: "2026-09-14T11:00:00.000Z",
            }
          : null,
      supersededAt: state === "superseded" ? "2026-09-15T10:00:00.000Z" : null,
      supersededByPiId: state === "superseded" ? "new-pi" : null,
    },
    {
      currentPiId: state === "superseded" ? "new-pi" : state,
      currentQuoteRevisionId: awaitingReplacement ? "next" : "quote",
      now:
        state === "expired"
          ? "2026-09-28T10:00:00.000Z"
          : "2026-09-15T10:00:00.000Z",
    },
  );
  return {
    id: state,
    requestId: "request",
    snapshotHash: target.snapshotHash,
    snapshot: {
      documentNumber: `PI-${state}`,
      documentVersion: 1,
      issuedAt: lifecycle.issuedAt,
      totals: { totalCents: 12300 },
    },
    lifecycle,
  };
}
it("shows every historical state and exact PDF links, with acceptance only for the current actionable PI", () => {
  render(
    <MemoryRouter>
      <PiLifecycleHistory
        records={[
          record("current"),
          record("accepted"),
          record("expired"),
          record("superseded"),
        ]}
      />
    </MemoryRouter>,
  );
  for (const label of ["Current", "Accepted", "Expired", "Superseded"])
    expect(screen.getByText(label)).toBeTruthy();
  expect(
    screen.getAllByRole("link", { name: "Review and accept" }),
  ).toHaveLength(1);
  const rows = screen.getAllByRole("listitem");
  expect(
    within(rows[0])
      .getByRole("link", { name: "Download PDF" })
      .getAttribute("href"),
  ).toBe(
    `/account/quotes/request/pi/current/pdf?documentVersion=1&snapshotHash=${"a".repeat(64)}`,
  );
  for (const [index, state] of [
    "accepted",
    "expired",
    "superseded",
  ].entries()) {
    const row = within(rows[index + 1]);
    expect(row.queryByRole("link", { name: "Review and accept" })).toBeNull();
    expect(
      row.getByRole("link", { name: "Download PDF" }).getAttribute("href"),
    ).toBe(`/account/quotes/request/pi/${state}/pdf`);
    expect(
      row.getByRole("link", { name: "View PDF" }).getAttribute("href"),
    ).toBe(`/account/quotes/request/pi/${state}/pdf?disposition=inline`);
  }
  expect(
    screen.getByRole("region", { name: "PI history" }).textContent,
  ).not.toMatch(/Customs|internal|evidenceIds/);
});
it("disables acceptance while a newer quote awaits its replacement PI", () => {
  render(
    <MemoryRouter>
      <PiLifecycleHistory records={[record("current", true)]} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Updated PI pending")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Review and accept" })).toBeNull();
});
it("renders no empty history section", () => {
  render(
    <MemoryRouter>
      <PiLifecycleHistory records={[]} />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("region")).toBeNull();
});
