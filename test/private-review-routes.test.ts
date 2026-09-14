import { expect, it } from "vitest";
import { RouterContextProvider } from "react-router";
import { cloudflareContext } from "../workers/context";
import {
  loader,
  action,
} from "../app/modules/admin/routes/quote-private-review";
import { loader as download } from "../app/modules/admin/routes/quote-private-download";

it("denies customer contexts before accessing private storage", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {} as CloudflareBindings,
    runtime: { environment: "local" },
    ctx: {} as ExecutionContext,
  });
  const url = new URL("http://admin.localhost/admin/quotes/rfq/private");
  const args = {
    context,
    request: new Request(url),
    url,
    params: { requestId: "rfq" },
    pattern: "/admin/quotes/:requestId/private",
  };
  await expect(loader(args)).rejects.toMatchObject({ status: 403 });
  await expect(action(args)).rejects.toMatchObject({ status: 403 });
  await expect(
    download({ ...args, pattern: "/admin/quotes/:requestId/private/download" }),
  ).rejects.toMatchObject({ status: 403 });
});
