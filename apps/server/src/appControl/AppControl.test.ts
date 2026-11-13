import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { type AppCommand, AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AppControl from "./AppControl.ts";

const commandAction = (command: AppCommand) => ({ _tag: "command", command }) as const;
const makeAppControl = AppControl.make.pipe(Effect.provide(NodeCrypto.layer));
const desktop = { sessionId: AuthSessionId.make("desktop"), windowId: "socket-a:0" };
const browser = { sessionId: AuthSessionId.make("browser"), windowId: "socket-b:0" };
// Another tab of the same browser: same session and RPC client id, its own socket.
const browserTab = { ...browser, windowId: "socket-c:0" };

it.effect("runs a command in the window used most recently and returns its answer", () =>
  Effect.gen(function* () {
    const appControl = yield* makeAppControl;
    const desktopRequests = yield* appControl.connect(desktop, false);
    const browserRequests = yield* appControl.connect(browser, true);
    // A tab connecting in the background doesn't take over from the one in use.
    yield* appControl.connect(browserTab, false).pipe(Effect.asVoid);
    const toBrowser = yield* appControl.run(commandAction("sidebar.toggle")).pipe(Effect.forkChild);
    const browserRequest = Option.getOrThrow(yield* Stream.runHead(browserRequests));
    yield* appControl.respond(browser.sessionId, {
      requestId: browserRequest.requestId,
      result: "ran",
    });
    expect(yield* Fiber.join(toBrowser)).toBe("ran");
    yield* appControl.reportFocus(desktop, true);
    const run = yield* appControl.run(commandAction("terminal.toggle")).pipe(Effect.forkChild);
    const request = Option.getOrThrow(yield* Stream.runHead(desktopRequests));
    expect(request.action).toEqual(commandAction("terminal.toggle"));
    // Another session cannot answer for this window.
    yield* appControl.respond(browser.sessionId, { requestId: request.requestId, result: "ran" });
    yield* appControl.respond(desktop.sessionId, {
      requestId: request.requestId,
      result: "not-handled",
    });
    expect(yield* Fiber.join(run)).toBe("not-handled");
  }).pipe(Effect.scoped),
);

it.effect("fails when no window is open or the window does not answer", () =>
  Effect.gen(function* () {
    const appControl = yield* makeAppControl;
    yield* Effect.scoped(appControl.connect(desktop, true).pipe(Effect.asVoid));
    expect(
      yield* appControl.run(commandAction("terminal.toggle")).pipe(Effect.flip),
    ).toBeInstanceOf(AppControl.AppControlNoWindowError);
    const requests = yield* appControl.connect(desktop, true);
    const run = yield* appControl.run(commandAction("terminal.toggle")).pipe(Effect.forkChild);
    yield* Stream.runHead(requests);
    yield* TestClock.adjust("5 seconds");
    expect(yield* Fiber.join(run).pipe(Effect.flip)).toBeInstanceOf(
      AppControl.AppControlTimeoutError,
    );
  }).pipe(Effect.scoped),
);
