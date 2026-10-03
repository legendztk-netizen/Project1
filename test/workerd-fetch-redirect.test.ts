import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, it } from "vitest";

// Workers' fetch accepts only redirect "follow" or "manual"; "error" throws
// before any request is sent. Node accepts all three, so unit tests with a
// mocked fetch cannot catch it: quote notification email and DKIM DNS lookups
// both failed on preview this way.
const supported = ["follow", "manual"];

it("uses only redirect modes the Workers runtime supports", () => {
  const found: string[] = [];
  for (const root of ["app", "workers"])
    for (const file of readdirSync(root, { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(file)) continue;
      const source = readFileSync(join(root, file), "utf8");
      for (const [, mode] of source.matchAll(/redirect:\s*["'`](\w+)["'`]/g))
        found.push(`${join(root, file)}: ${mode}`);
    }
  expect(found.length).toBeGreaterThan(0);
  expect(
    found.filter((entry) => !supported.includes(entry.split(": ")[1])),
  ).toEqual([]);
});

it("matches the redirect modes workerd actually accepts", async () => {
  const require = createRequire(import.meta.url);
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare") as {
    Miniflare: new (options: object) => {
      dispatchFetch(url: string): Promise<Response>;
      dispose(): Promise<void>;
    };
    convertV4MiniflareOptions(options: object): object;
  };
  const worker = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      compatibilityDate: "2026-08-15",
      script: `export default { fetch() {
        const accepted = [];
        for (const redirect of ["error", "follow", "manual"])
          try { new Request("https://example.com", { redirect }); accepted.push(redirect); } catch {}
        return Response.json(accepted);
      } };`,
    }),
  );
  try {
    expect(
      await (await worker.dispatchFetch("http://localhost/")).json(),
    ).toEqual(supported);
  } finally {
    await worker.dispose();
  }
});
