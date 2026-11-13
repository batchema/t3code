import type {
  AppCommand,
  AppControlRequest,
  AppControlResponseInput,
  AuthSessionId,
  RpcClientId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

/** One window's connection to this server. */
export interface AppControlClient {
  readonly sessionId: AuthSessionId;
  readonly rpcClientId: RpcClientId;
}

export class AppControlNoWindowError extends Schema.TaggedError<AppControlNoWindowError>()(
  "AppControlNoWindowError",
  {},
) {}

export class AppControlTimeoutError extends Schema.TaggedError<AppControlTimeoutError>()(
  "AppControlTimeoutError",
  {},
) {}

const RESPONSE_TIMEOUT = "5 seconds";

export class AppControl extends Context.Service<
  AppControl,
  {
    /** Registers a window; the commands sent to it arrive until the scope closes. */
    readonly connect: (
      client: AppControlClient,
    ) => Effect.Effect<Stream.Stream<AppControlRequest>, never, Scope.Scope>;
    readonly reportFocus: (client: AppControlClient, focused: boolean) => Effect.Effect<void>;
    readonly respond: (
      sessionId: AuthSessionId,
      response: AppControlResponseInput,
    ) => Effect.Effect<void>;
    /** Runs a command in the window used most recently; false when nothing there handles it. */
    readonly run: (
      command: AppCommand,
    ) => Effect.Effect<boolean, AppControlNoWindowError | AppControlTimeoutError>;
  }
>()("t3/appControl/AppControl") {}

interface Window {
  readonly sessionId: AuthSessionId;
  readonly queue: Queue.Queue<AppControlRequest>;
  readonly focusOrder: number;
}

interface Pending {
  readonly sessionId: AuthSessionId;
  readonly deferred: Deferred.Deferred<boolean>;
}

interface State {
  readonly windows: ReadonlyMap<string, Window>;
  readonly pending: ReadonlyMap<string, Pending>;
  readonly focusSequence: number;
}

const windowKey = (client: AppControlClient) => `${client.sessionId}:${client.rpcClientId}`;

export const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const state = yield* Ref.make<State>({
    windows: new Map(),
    pending: new Map(),
    focusSequence: 0,
  });

  /** Marks a window as the one used most recently. */
  const focusWindow = (current: State, key: string, window: Omit<Window, "focusOrder">): State => {
    const focusSequence = current.focusSequence + 1;
    const windows = new Map(current.windows).set(key, { ...window, focusOrder: focusSequence });
    return { ...current, windows, focusSequence };
  };

  const connect: AppControl["Service"]["connect"] = (client) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<AppControlRequest>();
        // A window that just connected is the one in use until another reports focus.
        yield* Ref.update(state, (current) =>
          focusWindow(current, windowKey(client), { sessionId: client.sessionId, queue }),
        );
        return queue;
      }),
      (queue) =>
        Ref.update(state, (current) => {
          if (current.windows.get(windowKey(client))?.queue !== queue) return current;
          const windows = new Map(current.windows);
          windows.delete(windowKey(client));
          return { ...current, windows };
        }),
    ).pipe(Effect.map((queue) => Stream.fromQueue(queue)));

  const reportFocus: AppControl["Service"]["reportFocus"] = (client, focused) =>
    Ref.update(state, (current) => {
      const window = current.windows.get(windowKey(client));
      return focused && window !== undefined
        ? focusWindow(current, windowKey(client), window)
        : current;
    });

  const respond: AppControl["Service"]["respond"] = Effect.fn("AppControl.respond")(
    function* (sessionId, response) {
      const pending = yield* Ref.get(state).pipe(
        Effect.map((current) => current.pending.get(response.requestId)),
      );
      if (pending?.sessionId !== sessionId) return;
      yield* Deferred.succeed(pending.deferred, response.handled);
    },
  );

  const run: AppControl["Service"]["run"] = Effect.fn("AppControl.run")(function* (command) {
    const requestId = yield* random.uuidV4();
    const deferred = yield* Deferred.make<boolean>();
    const target = yield* Ref.modify(state, (current) => {
      const window = Array.from(current.windows.values()).reduce<Window | undefined>(
        (latest, next) =>
          latest === undefined || next.focusOrder > latest.focusOrder ? next : latest,
        undefined,
      );
      if (window === undefined) return [undefined, current] as const;
      const pending = new Map(current.pending).set(requestId, {
        sessionId: window.sessionId,
        deferred,
      });
      return [window, { ...current, pending }] as const;
    });
    if (target === undefined) return yield* new AppControlNoWindowError();
    const removePending = Ref.update(state, (current) => {
      const pending = new Map(current.pending);
      pending.delete(requestId);
      return { ...current, pending };
    });
    return yield* Queue.offer(target.queue, { requestId, command }).pipe(
      Effect.andThen(Deferred.await(deferred).pipe(Effect.timeoutOption(RESPONSE_TIMEOUT))),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new AppControlTimeoutError()),
          onSome: Effect.succeed,
        }),
      ),
      Effect.ensuring(removePending),
    );
  });

  return AppControl.of({ connect, reportFocus, respond, run });
});

export const layer = Layer.effect(AppControl, make);
