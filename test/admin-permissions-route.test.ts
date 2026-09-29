import { expect, it, vi } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import { action } from "../app/modules/admin/routes/admin-permissions";
import { owner } from "./fixtures/after-sales-order";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("../app/modules/admin/infrastructure/d1-admin-accounts", () => ({
  createAdminAccounts: () => ({ mutate: save }),
}));
function args(method: string, origin?: string, isOwner = true) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
    ctx: {} as ExecutionContext,
    runtime: { environment: "local" },
    adminIdentity: { ...owner, accountType: isOwner ? "owner" : "subaccount" },
  });
  return {
    context,
    url: new URL("https://admin.example.test/admin/settings/permissions"),
    params: {},
    request: new Request(
      "https://admin.example.test/admin/settings/permissions",
      {
        method,
        headers: origin ? { Origin: origin } : {},
        ...(method === "POST"
          ? {
              body: new URLSearchParams({
                id: "staff",
                intent: "permissions",
                "module.after_sales": "write",
                commandId: crypto.randomUUID(),
                version: "4",
              }),
            }
          : {}),
      },
    ),
    pattern: "/admin/settings/permissions",
  };
}
it("rejects foreign or absent Origin, GET and subaccount mutations before saving", async () => {
  for (const input of [
    args("POST", "https://evil.example.test"),
    args("POST"),
    args("GET", "https://admin.example.test"),
    args("POST", "https://admin.example.test", false),
  ]) {
    await expect(action(input)).rejects.toMatchObject({
      status: input.request.method === "GET" ? 405 : 403,
    });
  }
  expect(save).not.toHaveBeenCalled();
});
it("passes the displayed version and valid same-origin Owner command to the repository", async () => {
  const response = await action(args("POST", "https://admin.example.test"));
  expect(response).toMatchObject({ ok: true, intent: "permissions" });
  const [actor, form] = save.mock.calls.at(-1)!;
  expect(actor).toBe(owner.id);
  expect(form.get("id")).toBe("staff");
  expect(form.get("version")).toBe("4");
  expect(form.get("module.after_sales")).toBe("write");
});
