import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, subscribeDynamic } from "@t3tools/client-runtime/rpc";
import {
  type AppAction,
  type AppCommand,
  type AppControlResult,
  type AppDestination,
  VIEW_ONLY_APP_COMMANDS,
  WS_METHODS,
} from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { useComposerDraftStore } from "../composerDraftStore";
import { readPullRequestListPreferences } from "../components/pullRequest/pullRequestListPreferences";
import type { SettingsPath } from "../components/settings/settingsSearch";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { runCommand } from "../shortcuts/dispatcher";
import { resolveThreadRouteTarget } from "../threadRoutes";

/** Runs the commands agents send this window, from every environment it is connected to. */
export function startAppControl(router: AnyRouter): () => void {
  // Outside view-only commands, a command runs only on its own environment's thread or draft,
  // so an agent can't act through this window on an environment it has no access to.
  const shownEnvironmentIds = () => {
    const params: Record<string, string | undefined> = router.state.matches.at(-1)?.params ?? {};
    const target = resolveThreadRouteTarget(params);
    const draft =
      target?.kind === "draft"
        ? useComposerDraftStore.getState().getDraftSession(target.draftId)
        : null;
    return [params.environmentId, draft?.environmentId, draft?.loadBalancedEnvironmentId];
  };
  const run = (environmentId: string, command: AppCommand): AppControlResult => {
    if (!VIEW_ONLY_APP_COMMANDS.has(command)) {
      const shown = shownEnvironmentIds().filter((id) => id != null);
      if (shown.length === 0 || shown.some((id) => id !== environmentId))
        return "other-environment";
    }
    return runCommand(command) ? "ran" : "not-handled";
  };
  const navigate = (environmentId: string, to: AppDestination): AppControlResult => {
    switch (to.page) {
      case "thread":
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: to.threadId },
        });
        break;
      case "settings": {
        const path: SettingsPath | "/settings" = to.section
          ? `/settings/${to.section}`
          : "/settings";
        void router.navigate({ to: path });
        break;
      }
      case "usage":
        void router.navigate({ to: "/usage" });
        break;
      case "pull-requests":
        void router.navigate({ to: "/pull-requests", search: readPullRequestListPreferences() });
        break;
    }
    return "ran";
  };
  const act = (environmentId: string, action: AppAction) =>
    action._tag === "command"
      ? run(environmentId, action.command)
      : navigate(environmentId, action.to);
  const focused = Effect.sync(() => ({
    focused: document.hasFocus() && document.visibilityState === "visible",
  }));
  const atom = connectionAtomRuntime.atom(
    Effect.gen(function* () {
      const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
      yield* Stream.concat(
        Stream.fromEffect(SubscriptionRef.get(registry.entries)),
        SubscriptionRef.changes(registry.entries),
      ).pipe(
        Stream.map((entries) => [...entries.keys()]),
        Stream.changesWith((previous, current) => previous.join() === current.join()),
        Stream.switchMap((environmentIds) =>
          Stream.mergeAll(
            environmentIds.map((environmentId) =>
              registry.followStream(
                environmentId,
                subscribeDynamic(WS_METHODS.subscribeAppControl, () => focused).pipe(
                  Stream.mapEffect(({ requestId, action }) =>
                    request(WS_METHODS.appControlRespond, {
                      requestId,
                      result: act(environmentId, action),
                    }).pipe(Effect.ignoreCause),
                  ),
                  Stream.ignoreCause,
                ),
              ),
            ),
            { concurrency: "unbounded" },
          ),
        ),
        Stream.runDrain,
      );
    }),
  );
  return appAtomRegistry.mount(atom);
}
