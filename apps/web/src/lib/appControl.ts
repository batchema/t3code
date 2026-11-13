import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { request, subscribe } from "@t3tools/client-runtime/rpc";
import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { connectionAtomRuntime } from "../connection/runtime";
import { runCommand } from "../shortcuts/dispatcher";

/** Runs the commands agents send this window, from every environment it is connected to. */
export const appControlAtom = connectionAtomRuntime.atom(
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
              subscribe(WS_METHODS.subscribeAppControl, {}).pipe(
                Stream.mapEffect(({ requestId, command }) =>
                  request(WS_METHODS.appControlRespond, {
                    requestId,
                    handled: runCommand(command),
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
