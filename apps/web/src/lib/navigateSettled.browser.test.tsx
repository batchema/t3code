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

function makeRouter(input: { nextLoader: () => Promise<void>; redirectHome: boolean }) {
  const root = createRootRoute({ component: Outlet });
  const home = createRoute({ getParentRoute: () => root, path: "/", component: () => <p>home</p> });
  const next = createRoute({
    getParentRoute: () => root,
    path: "/usage",
    beforeLoad: () => {
      if (input.redirectHome) throw redirect({ to: "/" });
    },
    loader: input.nextLoader,
    component: () => <p>usage</p>,
  });
  return createRouter({
    routeTree: root.addChildren([home, next]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("navigateSettled", () => {
  it("resolves once the destination is on screen, not when navigation starts", async () => {
    let openGate = () => {};
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    const router = makeRouter({ nextLoader: () => gate, redirectHome: false });
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

  it("resolves false when the window stays put", async () => {
    const router = makeRouter({ nextLoader: async () => {}, redirectHome: true });
    // The test needs its own route tree, with a route that redirects back.
    await using screen = await render(<RouterProvider router={router} />, { router: false });
    await expect.element(screen.getByText("home")).toBeInTheDocument();

    expect(await navigateSettled(router, { to: "/usage" })).toBe(false);
    expect(screen.container.textContent).toBe("home");
  });
});
