import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Keybindings from "../../../keybindings.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as EnvironmentHandlers from "./handlers.ts";
import { EnvironmentToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:preferences");
const threadId = ThreadId.make("thread:preferences");

const makeLayer = Effect.fn(function* (onGetThreadShell: Effect.Effect<void> = Effect.void) {
  const caller = yield* Ref.make<OrchestrationV2ThreadShell>(liveThreadShell(threadId));
  const writes = yield* Ref.make(0);
  const write = <A>(value: A) => Ref.update(writes, (count) => count + 1).pipe(Effect.as(value));
  const snapshot = { keybindings: DEFAULT_RESOLVED_KEYBINDINGS, issues: [] };
  const layer = McpToolAccess.HandlersLayer.layer(EnvironmentHandlers.layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        ThreadCommandExecutor.layer,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId,
          requestNamespace: "provider:preferences",
          thread: {
            threadId,
            providerSessionId: "provider:preferences",
            providerInstanceId: ProviderInstanceId.make("codex"),
          },
          client: undefined,
          capabilities: new Set(["orchestration" as const]),
          issuedAt: 0,
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Ref.get(caller).pipe(Effect.tap(() => onGetThreadShell)),
        }),
        Layer.mock(Environment.ServerEnvironment)({
          getDescriptor: Effect.succeed({
            environmentId,
            label: "Test",
            platform: { os: "linux", arch: "x64" },
            serverVersion: "0.0.0",
            capabilities: { repositoryIdentity: false },
          }),
        }),
        Layer.mock(Settings.ServerSettingsService)({
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
          updateSettings: () => write(DEFAULT_SERVER_SETTINGS),
        }),
        Layer.mock(Keybindings.Keybindings)({
          getSnapshot: Effect.succeed(snapshot),
          upsertKeybindingRule: () => write(snapshot),
          removeKeybindingRule: () => write(snapshot),
        }),
      ),
    ),
  );
  return { caller, writes, layer };
});

const call = (...[name, params]: Parameters<Effect.Success<typeof EnvironmentToolkit>["handle"]>) =>
  EnvironmentToolkit.pipe(
    Effect.flatMap((toolkit) =>
      toolkit.handle(name, params).pipe(Stream.unwrap, Stream.runCollect),
    ),
    Effect.map((results) => results.at(-1)?.result),
  );

it.effect("refuses a settings update when the caller's turn ends while it waits", () =>
  Effect.gen(function* () {
    const checked = yield* Deferred.make<void>();
    const { caller, writes, layer } = yield* makeLayer(Deferred.succeed(checked, undefined));
    yield* Effect.gen(function* () {
      const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
      const held = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const holder = yield* executor
        .withLock(
          threadId,
          Deferred.succeed(held, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(held);
      const update = yield* call("t3_environment_settings_update", {
        patch: { newWorktreesStartFromOrigin: true },
      }).pipe(Effect.forkChild);
      yield* Deferred.await(checked);
      yield* Ref.update(caller, (shell) => ({ ...shell, activeRunId: null }));
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      expect(yield* Fiber.join(update)).toMatchObject({ code: "parent_not_active" });
      expect(yield* Ref.get(writes)).toBe(0);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("refuses settings and shortcuts agents may not or cannot write", () =>
  Effect.gen(function* () {
    const { writes, layer } = yield* makeLayer();
    const cases = [
      [
        call("t3_environment_settings_update", { patch: { enableAgentDeviceAccess: true } }),
        "capability_denied",
      ],
      [call("t3_environment_settings_update", { patch: { notASetting: true } }), "invalid_request"],
      [
        call("t3_environment_settings_update", { patch: { linkedEnvironmentsEnabled: "yes" } }),
        "invalid_request",
      ],
      [call("t3_environment_settings_update", { patch: {} }), "invalid_request"],
      [call("t3_environment_settings_read", { keys: ["notASetting"] }), "invalid_request"],
      [call("t3_keybinding_upsert", { key: "mod+k", command: "not.a.command" }), "invalid_request"],
      [
        call("t3_keybinding_upsert", { key: "mod+k+j", command: "terminal.toggle" }),
        "invalid_request",
      ],
      [
        call("t3_keybinding_remove", { key: "mod+k", command: "terminal.toggle" }),
        "invalid_request",
      ],
    ] as const;
    yield* Effect.gen(function* () {
      for (const [result, code] of cases) expect(yield* result).toMatchObject({ code });
      expect(yield* Ref.get(writes)).toBe(0);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("matches a shortcut to remove however its rule is spelled", () =>
  Effect.gen(function* () {
    const { writes, layer } = yield* makeLayer();
    yield* Effect.gen(function* () {
      const result = yield* call("t3_keybinding_remove", {
        key: "MOD+SHIFT+B",
        command: "threadPanel.toggle",
        when: "!terminalFocus",
      });
      expect(result).toHaveProperty("keybindings");
      expect(yield* Ref.get(writes)).toBe(1);
    }).pipe(Effect.provide(layer));
  }),
);
