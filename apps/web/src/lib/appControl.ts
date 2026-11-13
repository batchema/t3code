import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { request, subscribeDynamic } from "@t3tools/client-runtime/rpc";
import {
  type AppAction,
  type AppCommand,
  type AppControlResult,
  type AppDestination,
  EnvironmentId,
  VIEW_ONLY_APP_COMMANDS,
  WS_METHODS,
} from "@t3tools/contracts";
import type { AnyRouter, NavigateOptions } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { useComposerDraftStore } from "../composerDraftStore";
import { readPullRequestListPreferences } from "../components/pullRequest/pullRequestListPreferences";
import type { SettingsPath } from "../components/settings/settingsSearch";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { runCommand } from "../shortcuts/dispatcher";
import { waitForThreadShell } from "../state/entities";
import { navigateSettled } from "./navigateSettled";
import { resolveThreadRouteTarget } from "../threadRoutes";

// The server stops waiting for an answer after this long.
const RESPONSE_DEADLINE = "5 seconds";

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
  const destination = (environmentId: string, to: AppDestination): NavigateOptions => {
    switch (to.page) {
      case "thread":
        return {
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: to.threadId },
        } as const;
      case "settings": {
        // Straight to a section: `/settings` redirects, which would look like a blocked move.
        const path: SettingsPath = `/settings/${to.section ?? "general"}`;
        return { to: path };
      }
      case "usage":
        return { to: "/usage" } as const;
      case "pull-requests":
        return { to: "/pull-requests", search: readPullRequestListPreferences() } as const;
    }
  };
  const act = async (environmentId: string, action: AppAction): Promise<AppControlResult> => {
    if (action._tag === "command") return run(environmentId, action.command);
    const { to } = action;
    if (!(await navigateSettled(router, destination(environmentId, to)))) return "not-handled";
    // An older thread mounts its chat only once its row loads, after the route has settled.
    if (
      to.page === "thread" &&
      !(await waitForThreadShell(scopeThreadRef(EnvironmentId.make(environmentId), to.threadId)))
    )
      return "not-handled";
    return "ran";
  };
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
                    // Requests run in order, so one that never settles must not hold the rest.
                    Effect.promise(() => act(environmentId, action)).pipe(
                      Effect.timeout(RESPONSE_DEADLINE),
                      Effect.flatMap((result) =>
                        request(WS_METHODS.appControlRespond, { requestId, result }),
                      ),
                      Effect.ignoreCause,
                    ),
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
