import type { AnyRouter, NavigateOptions } from "@tanstack/react-router";

/**
 * Navigates and resolves once the destination is on screen, so a command sent next reaches it.
 * Resolves false when the window stayed put, such as a redirect back. A blocked navigation never
 * settles (TanStack leaves it pending), so callers bound the wait.
 */
export async function navigateSettled(
  router: AnyRouter,
  options: NavigateOptions,
): Promise<boolean> {
  const from = router.state.location.href;
  if (router.buildLocation(options).href === from) return true;
  await router.navigate(options);
  return router.state.location.href !== from;
}
