// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";

import type { RootLoaderData } from "../app/root";
import { homeVideoUrl } from "../app/modules/storefront/ui/home-media";
import { HomePage } from "../app/modules/storefront/ui/home-page";

function renderHome() {
  const router = createMemoryRouter(
    [
      {
        children: [
          { element: <HomePage appName="Hydraulic Supply" />, index: true },
        ],
        element: <Outlet />,
        id: "root",
        loader: () => ({ customer: null }) satisfies RootLoaderData,
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

afterEach(cleanup);

describe("Storefront home page", () => {
  it("leads with Build a Hose and product search", async () => {
    renderHome();

    expect(
      (await screen.findByRole("heading", { level: 1 })).textContent,
    ).toContain("built to your length");
    const hero = screen
      .getByRole("heading", { level: 1 })
      .closest("section") as HTMLElement;
    expect(
      within(hero)
        .getByRole("link", { name: /Build a hose/u })
        .getAttribute("href"),
    ).toBe("/build-a-hose");
    expect(
      within(hero)
        .getByRole("link", { name: /Browse products/u })
        .getAttribute("href"),
    ).toBe("/catalog");
    const search = within(hero).getByRole("search");
    expect(search.getAttribute("action")).toBe("/catalog");
    expect(search.querySelector("input")?.getAttribute("name")).toBe("q");
  });

  it("links the three product groups to their catalog categories", async () => {
    renderHome();
    await screen.findByRole("heading", { level: 1 });

    const hrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    for (const path of [
      "/catalog/hydraulic-hose",
      "/catalog/hose-ends",
      "/catalog/ferrules",
      "/catalog/adapters",
      "/catalog/quick-couplers",
    ]) {
      expect(hrefs).toContain(path);
    }
  });

  it("floats the header and ends with a navigation footer", async () => {
    const { container } = renderHome();
    await screen.findByRole("heading", { level: 1 });

    expect(
      container.querySelector("header.storefront-header.is-floating"),
    ).not.toBeNull();
    const footer = screen.getByRole("navigation", { name: "Footer" });
    expect(
      within(footer)
        .getByRole("link", { name: "Build a Hose" })
        .getAttribute("href"),
    ).toBe("/build-a-hose");
    expect(
      within(footer)
        .getByRole("link", { name: "Returns Policy" })
        .getAttribute("href"),
    ).toBe("/policies/returns");
  });

  it("only loads and plays the videos after a click", async () => {
    const { container } = renderHome();
    await screen.findByRole("heading", { level: 1 });

    const videos = Array.from(container.querySelectorAll("video"));
    expect(
      videos.map((v) => v.querySelector("source")?.getAttribute("src")),
    ).toEqual([
      homeVideoUrl("customhoseco-build.mp4"),
      homeVideoUrl("pressure.mp4"),
    ]);
    for (const video of videos) {
      expect(video.getAttribute("preload")).toBe("none");
      expect(video.hasAttribute("autoplay")).toBe(false);
    }
    expect(videos[0]?.getAttribute("poster")).toBe(
      "/video/customhoseco-build-poster.jpg",
    );
    expect(
      screen.getAllByRole("button", { name: /^Play video:/u }),
    ).toHaveLength(2);
    // The factory clip has ambient sound, so it starts muted.
    expect(videos[1]?.muted).toBe(true);
  });

  it("gives the walkthrough its own module", async () => {
    renderHome();
    const heading = await screen.findByRole("heading", {
      name: "Build a Hose, start to finish.",
    });
    const section = heading.closest("section") as HTMLElement;
    expect(section.querySelectorAll("video")).toHaveLength(1);
  });
});
