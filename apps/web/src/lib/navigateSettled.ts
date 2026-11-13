import type { AnyRouter, NavigateOptions } from "@tanstack/react-router";

/**
 * Navigates and resolves once the destination is on screen, so a command sent next reaches it.
 * Resolves false when the window ends up elsewhere, such as after a redirect. A blocked navigation
 * never settles (TanStack leaves it pending), so callers bound the wait.
 */
export async function navigateSettled(
  router: AnyRouter,
  options: NavigateOptions,
): Promise<boolean> {
  const target = router.buildLocation(options).pathname;
  if (router.state.location.pathname !== target) await router.navigate(options);
  return router.state.location.pathname === target;
}
