import {
  OrchestratorMcpFailure,
  ServerSettings,
  ServerSettingsPatch,
  STATIC_KEYBINDING_COMMANDS,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Environment from "../../../environment/ServerEnvironment.ts";
import * as Keybindings from "../../../keybindings.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, unavailable } from "../../threadAccess.ts";
import { EnvironmentToolkit } from "./tools.ts";

export function preferences(settings: ServerSettings) {
  const {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity,
    sourceControlWritingStyle,
  } = settings;
  const characters = Array.from(sourceControlWritingStyle.customInstructions);
  return {
    defaultThreadEnvMode,
    newWorktreesStartFromOrigin,
    enableProviderUpdateChecks,
    backgroundActivity: { profile: backgroundActivity.profile },
    sourceControlWritingStyle: {
      ...sourceControlWritingStyle,
      customInstructions: characters.slice(0, 4000).join(""),
      truncated: characters.length > 4000,
    },
  };
}

// The user grants agents these; an agent must not grant them to itself. Device hosts also need
// the local-host filtering only the RPC path applies.
const USER_ONLY_SETTINGS = new Set([
  "enableAgentBrowserAccess",
  "enableAgentDeviceAccess",
  "projectAgentBrowserAccessOverrides",
  "deviceHosts",
]);
const SETTINGS_KEYS = new Set(Object.keys(ServerSettings.fields));
const PATCH_KEYS = new Set(Object.keys(ServerSettingsPatch.fields));

const invalid = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const decodePatch = Schema.decodeUnknownEffect(ServerSettingsPatch);
const encodeSettings = Schema.encodeEffect(ServerSettings);
const decodeKeybinding = Schema.decodeUnknownEffect(Keybindings.ResolvedKeybindingFromConfig);
const encodeKeybinding = Schema.encodeEffect(Keybindings.ResolvedKeybindingFromConfig);

const settingsView = (settings: ServerSettings, keys: ReadonlyArray<string> | undefined) =>
  encodeSettings(Settings.redactServerSettingsForClient(settings, { secretReferences: true })).pipe(
    Effect.mapError(unavailable),
    Effect.map((encoded) =>
      keys === undefined
        ? encoded
        : Object.fromEntries(Object.entries(encoded).filter(([key]) => keys.includes(key))),
    ),
  );

const keybindingsView = (keybindings: ResolvedKeybindingsConfig) =>
  Effect.forEach(keybindings, (rule) =>
    encodeKeybinding(rule).pipe(Effect.mapError(unavailable)),
  ).pipe(
    Effect.map((rules) =>
      rules.map(({ key, command, when }) =>
        when === undefined ? { key, command } : { key, command, when },
      ),
    ),
  );

/** Rejects what the service would store as a broken entry, and returns the canonical spelling. */
const canonicalRule = (input: { key: string; command: string; when?: string }) =>
  decodeKeybinding(input).pipe(
    Effect.mapError((error) => invalid(`Invalid shortcut: ${error.message}`)),
    Effect.flatMap((resolved) => encodeKeybinding(resolved).pipe(Effect.mapError(unavailable))),
  );

const access = Effect.gen(function* () {
  const context = yield* readCaller();
  const environment = yield* Environment.ServerEnvironment;
  const descriptor = yield* environment.getDescriptor;
  if (descriptor.environmentId !== context.scope.environmentId)
    return yield* new OrchestratorMcpFailure({
      code: "capability_denied",
      message: "This credential belongs to another environment.",
    });
  return {
    ...context,
    descriptor,
    settings: yield* Settings.ServerSettingsService,
    keybindings: yield* Keybindings.Keybindings,
  };
});

/** Runs a write under the caller thread's lock, rechecking access once the lock is held. */
const writeLocked = Effect.fn("EnvironmentTools.writeLocked")(function* <A, R>(
  check: Effect.Effect<unknown, OrchestratorMcpFailure, R>,
  write: Effect.Effect<A, OrchestratorMcpFailure, R>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const executor = yield* ThreadCommandExecutor.ThreadCommandExecutor;
  // The turn may have ended, or the thread's modes changed, while this waited for the lock.
  const update = check.pipe(Effect.andThen(write));
  return yield* scope.thread === undefined
    ? update
    : executor.withLock(scope.thread.threadId, update);
});

export const layer = McpToolAccess.toLayer(EnvironmentToolkit, {
  t3_environment_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { descriptor, settings } = yield* access;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return {
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        serverVersion: descriptor.serverVersion,
        platform: descriptor.platform,
        preferences: preferences(current),
      };
    }),
  ),
  t3_environment_settings_read: McpToolAccess.reads(({ keys }) =>
    Effect.gen(function* () {
      const unknown = (keys ?? []).filter((key) => !SETTINGS_KEYS.has(key));
      if (unknown.length > 0) return yield* invalid(`Unknown settings: ${unknown.join(", ")}.`);
      const { settings } = yield* access;
      const current = yield* settings.getSettings.pipe(Effect.mapError(unavailable));
      return { settings: yield* settingsView(current, keys) };
    }),
  ),
  t3_environment_settings_update: McpToolAccess.writesEnvironment(({ patch }, check) =>
    Effect.gen(function* () {
      const keys = Object.keys(patch);
      if (keys.length === 0) return yield* invalid("`patch` is empty.");
      const unknown = keys.filter((key) => !PATCH_KEYS.has(key));
      if (unknown.length > 0)
        return yield* invalid(`Unknown or read-only settings: ${unknown.join(", ")}.`);
      const userOnly = keys.filter((key) => USER_ONLY_SETTINGS.has(key));
      if (userOnly.length > 0)
        return yield* new OrchestratorMcpFailure({
          code: "capability_denied",
          message: `Only the user can change ${userOnly.join(", ")}, in Settings.`,
        });
      const decoded = yield* decodePatch(patch).pipe(
        Effect.mapError((error) => invalid(`Invalid settings: ${error.message}`)),
      );
      return yield* writeLocked(
        check,
        Effect.gen(function* () {
          const { settings } = yield* access;
          const next = yield* settings.updateSettings(decoded).pipe(Effect.mapError(unavailable));
          return { settings: yield* settingsView(next, keys) };
        }),
      );
    }),
  ),
  t3_keybindings_read: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const { keybindings } = yield* access;
      const snapshot = yield* keybindings.getSnapshot.pipe(Effect.mapError(unavailable));
      return {
        keybindings: yield* keybindingsView(snapshot.keybindings),
        commands: [...STATIC_KEYBINDING_COMMANDS],
        issues: snapshot.issues.map((issue) => issue.message),
      };
    }),
  ),
  t3_keybinding_upsert: McpToolAccess.writesEnvironment(({ replace, ...input }, check) =>
    Effect.gen(function* () {
      const rule = yield* canonicalRule(input);
      const target = replace === undefined ? undefined : yield* canonicalRule(replace);
      return yield* writeLocked(
        check,
        Effect.gen(function* () {
          const { keybindings } = yield* access;
          const next = yield* keybindings
            .upsertKeybindingRule(target ? { ...rule, replace: target } : rule)
            .pipe(Effect.mapError(unavailable));
          const commands = new Set([rule.command, target?.command]);
          return {
            keybindings: yield* keybindingsView(
              next.keybindings.filter((binding) => commands.has(binding.command)),
            ),
          };
        }),
      );
    }),
  ),
  t3_keybinding_remove: McpToolAccess.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      const target = yield* canonicalRule(input);
      return yield* writeLocked(
        check,
        Effect.gen(function* () {
          const { keybindings } = yield* access;
          const current = yield* keybindings.getSnapshot.pipe(Effect.mapError(unavailable));
          const listed = yield* keybindingsView(current.keybindings);
          if (!listed.some((rule) => Keybindings.isSameKeybindingRule(rule, target)))
            return yield* invalid("No such shortcut. `t3_keybindings_read` lists them.");
          const next = yield* keybindings
            .removeKeybindingRule(target)
            .pipe(Effect.mapError(unavailable));
          return {
            keybindings: yield* keybindingsView(
              next.keybindings.filter((binding) => binding.command === target.command),
            ),
          };
        }),
      );
    }),
  ),
});
