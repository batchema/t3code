import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
  type ServerSettings,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig, DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
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

const projectId = ProjectId.make("project:preferences");
// Valid at the 256-character limit; a fully parenthesized re-encoding would exceed it.
const longWhen = Array.from({ length: 15 }, () => "terminalFocus").join(" && ");
const longRule = { key: "mod+alt+k", command: "terminal.toggle" as const, when: longWhen };

const makeLayer = Effect.fn(function* (
  options: {
    readonly onGetThreadShell?: Effect.Effect<void>;
    readonly settings?: ServerSettings;
  } = {},
) {
  const { onGetThreadShell = Effect.void, settings = DEFAULT_SERVER_SETTINGS } = options;
  const caller = yield* Ref.make<OrchestrationV2ThreadShell>(liveThreadShell(threadId));
  const writes = yield* Ref.make(0);
  const write = <A>(value: A) => Ref.update(writes, (count) => count + 1).pipe(Effect.as(value));
  const snapshot = {
    keybindings: compileResolvedKeybindingsConfig([...DEFAULT_KEYBINDINGS, longRule]),
    issues: [],
  };
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
          getSettings: Effect.succeed(settings),
          updateSettings: () => write(settings),
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
    const { caller, writes, layer } = yield* makeLayer({
      onGetThreadShell: Deferred.succeed(checked, undefined),
    });
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
      [
        call("t3_environment_settings_update", {
          patch: { projectSettingsOverrides: { [projectId]: { enableAgentDeviceAccess: true } } },
        }),
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

it.effect("lets agents give up browser and device access but not take back a denial", () =>
  Effect.gen(function* () {
    const { writes, layer } = yield* makeLayer({
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        enableAgentBrowserAccess: true,
        projectSettingsOverrides: { [projectId]: { enableAgentBrowserAccess: false } },
      },
    });
    yield* Effect.gen(function* () {
      for (const entry of [null, {}])
        expect(
          yield* call("t3_environment_settings_update", {
            patch: { projectSettingsOverrides: { [projectId]: entry } },
          }),
        ).toMatchObject({ code: "capability_denied" });
      expect(yield* Ref.get(writes)).toBe(0);
      expect(
        yield* call("t3_environment_settings_update", {
          patch: { enableAgentBrowserAccess: false },
        }),
      ).toHaveProperty("settings");
      expect(yield* Ref.get(writes)).toBe(1);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("lists every loaded shortcut and removes one however its rule is spelled", () =>
  Effect.gen(function* () {
    const { writes, layer } = yield* makeLayer();
    yield* Effect.gen(function* () {
      const read = yield* call("t3_keybindings_read", {});
      const listed = (read as { keybindings: ReadonlyArray<{ when?: string }> }).keybindings;
      const long = listed.find((rule) => rule.when?.includes("terminalFocus && terminalFocus"));
      expect(long).toBeDefined();
      expect(yield* call("t3_keybinding_remove", { ...longRule, ...long })).toHaveProperty(
        "keybindings",
      );
      expect(
        yield* call("t3_keybinding_remove", {
          key: "MOD+SHIFT+B",
          command: "threadPanel.toggle",
          when: "!terminalFocus",
        }),
      ).toHaveProperty("keybindings");
      expect(yield* Ref.get(writes)).toBe(2);
    }).pipe(Effect.provide(layer));
  }),
);
