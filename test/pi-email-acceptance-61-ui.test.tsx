// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { renderToString } from "react-dom/server";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import EmailPage, {
  type EmailAcceptancePageData,
} from "../app/modules/admin/routes/pi-email-acceptance-page";
import CopiesPage, {
  type CopiesPageData,
} from "../app/modules/admin/routes/pi-acceptance-copies-page";

const page: EmailAcceptancePageData = {
  requestId: "quote-61",
  piId: "pi-61",
  documentNumber: "PI-2026-0061",
  documentVersion: 3,
  snapshotHash: "a".repeat(64),
  issuedAt: "2026-09-20T01:00:00Z",
  validUntil: "2026-10-04T01:00:00Z",
  current: true,
  expired: false,
  accepted: false,
  canAccept: true,
  conditions: {
    generalAcknowledgement: {
      version: "general-3",
      text: "I accept this PI, its prices and commercial terms.",
    },
    cancellation: {
      version: "cancel-3",
      text: "Made-to-order items cannot be cancelled after approval.",
    },
    refund: {
      version: "refund-2",
      text: "Refunds follow the agreed conditions.",
    },
    madeToOrderAcknowledgements: [
      {
        lineId: "custom-1",
        version: "custom-4",
        text: "Confirm the final specifications for this custom assembly.",
      },
    ],
  },
  lines: [{ id: "custom-1", sku: "ASSEMBLY-61" }],
  emails: [
    {
      id: "email-61",
      sender: "buyer@example.test",
      receivedAt: "2026-09-21T01:00:00Z",
      preview: "I accept PI-2026-0061.",
    },
  ],
  nextCursor: "older-email",
  selected: {
    id: "email-61",
    sender: "buyer@example.test",
    profileId: "buyer-61",
    receivedAt: "2026-09-21T01:00:00Z",
    body: "I accept PI-2026-0061. I accept its commercial terms.\nI confirm custom-1 specifications and cancellation conditions.\n<script>private evidence remains text</script>",
  },
  sourceError: null,
  commandId: "00000000-0000-4000-8000-000000000061",
};
const copies: CopiesPageData = {
  unresolved: true,
  local: true,
  commandIds: { "acceptance-61": "00000000-0000-4000-8000-000000000062" },
  page: {
    nextCursor: null,
    rows: [
      {
        id: "acceptance-61",
        state: "review",
        attempts: 10,
        dispatch_attempts: 1,
        generation: 1,
        failure_code: "delivery_budget_exhausted",
        created_at: Date.parse("2026-09-21T01:00:00Z"),
        completed_at: null,
        first_attempt_at: Date.parse("2026-09-20T01:00:00Z"),
        pi_id: "pi-61",
        request_id: "quote-61",
        document_number: "PI-2026-0061",
        document_version: 3,
        has_local_capture: 0,
        canRetry: false,
      },
    ],
  },
  capture: {
    from: "seller@local.invalid",
    to: ["buyer@example.test"],
    subject: "PI acceptance confirmation - PI-2026-0061",
    text: "PI acceptance confirmation\nDocument version: 3\nAccepted by: Test Buyer\nNo payment or production authorization.",
    reply_to: "seller@local.invalid",
  },
};
function router(element: React.ReactNode) {
  return createMemoryRouter([{ path: "/", element }]);
}
afterEach(cleanup);

it("renders exact PI, verified source and required separate acknowledgements without interpreting email HTML", () => {
  render(<RouterProvider router={router(<EmailPage loaderData={page} />)} />);
  expect(screen.getByLabelText("客户法定名称")).toHaveProperty(
    "required",
    true,
  );
  expect(screen.getAllByRole("checkbox")).toHaveLength(4);
  expect(
    screen
      .getAllByRole("textbox")
      .filter((input) => input instanceof HTMLTextAreaElement),
  ).toHaveLength(4);
  expect(screen.getByLabelText("经校验的客户邮件原文").textContent).toContain(
    "<script>",
  );
  expect(document.querySelector("main script")).toBeNull();
  expect(screen.getByText("a".repeat(64))).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "记录客户邮件接受" })
      .closest("fieldset"),
  ).toHaveProperty("disabled", false);
});

it("disables acceptance when source integrity fails or PI is no longer actionable", () => {
  render(
    <RouterProvider
      router={router(
        <EmailPage
          loaderData={{
            ...page,
            selected: null,
            canAccept: false,
            sourceError: "私有原文不可用",
          }}
        />,
      )}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("私有原文不可用");
  expect(
    screen
      .getByRole("button", { name: "记录客户邮件接受" })
      .closest("fieldset"),
  ).toHaveProperty("disabled", true);
});

it("shows failure review and explicit delivered/not-delivered reconciliation instead of an unsafe retry", () => {
  render(
    <RouterProvider router={router(<CopiesPage loaderData={copies} />)} />,
  );
  expect(screen.queryByRole("button", { name: "安排重试" })).toBeNull();
  fireEvent.click(screen.getByText("人工核对邮件服务投递结果"));
  expect(screen.getByLabelText("邮件服务投递 ID")).toHaveProperty(
    "required",
    true,
  );
  fireEvent.click(screen.getByLabelText("已确认未送达，建立新投递代次"));
  expect(screen.queryByLabelText("邮件服务投递 ID")).toBeNull();
  expect(
    screen.getByLabelText("邮件服务证据引用（工单或日志编号）"),
  ).toHaveProperty("required", true);
  expect(screen.getByRole("checkbox")).toHaveProperty("required", true);
  expect(screen.getByLabelText("本地确认副本正文").textContent).toContain(
    "Document version: 3",
  );
});

it("can render isolated desktop/mobile visual fixtures using the actual Admin stylesheet", () => {
  const output = process.env.PI61_RENDER_DIR;
  if (!output) return;
  mkdirSync(output, { recursive: true });
  const css = readFileSync("app/styles/app.css", "utf8");
  for (const [name, element] of [
    ["email-review", <EmailPage loaderData={page} />],
    ["copy-review", <CopiesPage loaderData={copies} />],
  ] as const) {
    const html = renderToString(<RouterProvider router={router(element)} />);
    writeFileSync(
      join(output, `${name}.html`),
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body>${html}</body></html>`,
    );
  }
});
