import { beforeEach, expect, it, vi } from "vitest";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../app/modules/admin/infrastructure/admin-request-context", () => ({
  requireAdminRequestContext: () => ({
    env: { DB: {}, PRIVATE_FILES: {} },
    adminIdentity: { id: "owner" },
  }),
}));
vi.mock(
  "../app/modules/shipment/application/shipment-documents-service",
  () => ({ createShipmentDocumentsService: () => ({ upload }) }),
);

import { action } from "../app/modules/admin/routes/shipment-documents";

beforeEach(() => upload.mockReset());

async function submitUpload(responseMode?: "dialog") {
  const url = new URL(
    "http://admin.localhost/admin/orders/order-1/shipments/shipment-1",
  );
  const form = new FormData();
  form.set("intent", "upload");
  form.set("commandId", "00000000-0000-4000-8000-000000000001");
  form.set("kind", "packing_list");
  if (responseMode) form.set("responseMode", responseMode);
  form.set(
    "file",
    new File(["%PDF-1.4\ntest"], "packing.pdf", {
      type: "application/pdf",
    }),
  );
  return action({
    request: new Request(url, {
      method: "POST",
      headers: { Origin: url.origin },
      body: form,
    }),
    params: { orderId: "order-1", shipmentId: "shipment-1" },
    context: {} as Parameters<typeof action>[0]["context"],
    url,
    pattern: "/admin/orders/:orderId/shipments/:shipmentId",
  });
}

it("issues a new upload command after a terminal reservation conflict", async () => {
  upload.mockRejectedValueOnce(
    new Response("Upload recovery required; start a new upload", {
      status: 409,
    }),
  );
  const result = await submitUpload();
  expect(result).toHaveProperty(
    "data.error",
    "上一次上传已中断，请重新选择文件并提交。",
  );
  const nextCommandId = (result as { data: { retryCommandId: string } }).data
    .retryCommandId;
  expect(nextCommandId).toMatch(/^[0-9a-f-]{36}$/);
  expect(nextCommandId).not.toBe("00000000-0000-4000-8000-000000000001");
});

it("retains the command ID when a transient object-store failure is retryable", async () => {
  upload.mockRejectedValueOnce(new Error("temporary R2 failure"));
  const result = await submitUpload();
  expect(result).toHaveProperty("data.retryCommandId", undefined);
});

it("redirects the standalone page but returns data to the order-page dialog", async () => {
  upload.mockResolvedValue(undefined);
  const page = await submitUpload();
  expect(page).toBeInstanceOf(Response);
  expect((page as Response).headers.get("Location")).toBe(
    "/admin/orders/order-1/shipments/shipment-1?tab=files&saved=1",
  );
  const dialog = await submitUpload("dialog");
  expect(dialog).toHaveProperty("data", { saved: true, tab: "files" });
});
