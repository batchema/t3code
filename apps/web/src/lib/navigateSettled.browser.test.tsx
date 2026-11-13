import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";
import { navigateSettled } from "./navigateSettled";

function makeRouter(input: { nextLoader: () => Promise<void>; redirect: boolean }) {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>home</p> });
  const next = createRoute({
    getParentRoute: () => root,
    path: "/usage",
    beforeLoad: () => {
      if (input.redirect) throw redirect({ to: "/settings/general" });
    },
    loader: input.nextLoader,
    component: () => <p>usage</p>,
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/settings/general",
    component: () => <p>settings</p>,
  });
  const thread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    component: () => <p>thread</p>,
  });
  return createRouter({
    routeTree: root.addChildren([home, next, settings, thread]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("navigateSettled", () => {
  it("resolves once the destination is on screen, not when navigation starts", async () => {
    let openGate = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const router = makeRouter({ nextLoader: () => gate, redirect: false });
    // The test needs its own route tree, with a loader that holds navigation pending.
    // Its paths reuse app routes so the registered route types accept them.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    await expect.element(screen.getByText("home")).toBeInTheDocument();

    let settled = false;
    const navigated = navigateSettled(router, { to: "/usage" }).finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(router.state.status).toBe("pending"));
    expect(settled).toBe(false);

    openGate();
    expect(await navigated).toBe(true);
    expect(screen.container.textContent).toBe("usage");
  });

  it("resolves false when the window ends up somewhere else", async () => {
    const router = makeRouter({ nextLoader: async () => {}, redirect: true });
    // The test needs its own route tree, with a route that redirects elsewhere.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    await expect.element(screen.getByText("home")).toBeInTheDocument();

    expect(await navigateSettled(router, { to: "/usage" })).toBe(false);
    await expect.element(screen.getByText("settings")).toBeInTheDocument();
  });

  it("arrives at a thread whose id needs encoding in the URL", async () => {
    const router = makeRouter({ nextLoader: async () => {}, redirect: false });
    // The test needs its own route tree; this one mirrors the app's thread route.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    await expect.element(screen.getByText("home")).toBeInTheDocument();

    const params = { environmentId: "environment", threadId: "mcp:thread" };
    expect(await navigateSettled(router, { to: "/$environmentId/$threadId", params })).toBe(true);
    expect(screen.container.textContent).toBe("thread");
  });
});
