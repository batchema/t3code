import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, RpcClientId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AppControl from "./AppControl.ts";

const makeAppControl = AppControl.make.pipe(Effect.provide(NodeCrypto.layer));
const window = (sessionId: string, rpcClientId: number) => ({
  sessionId: AuthSessionId.make(sessionId),
  rpcClientId: RpcClientId.make(rpcClientId),
});
const desktop = window("desktop", 1);
const browser = window("browser", 2);

it.effect("runs a command in the window used most recently and returns its answer", () =>
  Effect.gen(function* () {
    const appControl = yield* makeAppControl;
    const desktopRequests = yield* appControl.connect(desktop);
    yield* appControl.connect(browser).pipe(Effect.asVoid);
    yield* appControl.reportFocus(desktop, true);
    const run = yield* appControl.run("terminal.toggle").pipe(Effect.forkChild);
    const request = Option.getOrThrow(yield* Stream.runHead(desktopRequests));
    expect(request.command).toBe("terminal.toggle");
    // Another session cannot answer for this window.
    yield* appControl.respond(browser.sessionId, { requestId: request.requestId, handled: true });
    yield* appControl.respond(desktop.sessionId, { requestId: request.requestId, handled: false });
    expect(yield* Fiber.join(run)).toBe(false);
  }).pipe(Effect.scoped),
);

it.effect("fails when no window is open or the window does not answer", () =>
  Effect.gen(function* () {
    const appControl = yield* makeAppControl;
    yield* Effect.scoped(appControl.connect(desktop).pipe(Effect.asVoid));
    expect(yield* appControl.run("terminal.toggle").pipe(Effect.flip)).toBeInstanceOf(
      AppControl.AppControlNoWindowError,
    );
    const requests = yield* appControl.connect(desktop);
    const run = yield* appControl.run("terminal.toggle").pipe(Effect.forkChild);
    yield* Stream.runHead(requests);
    yield* TestClock.adjust("5 seconds");
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBeInstanceOf(
      AppControl.AppControlTimeoutError,
    );
  }).pipe(Effect.scoped),
);
