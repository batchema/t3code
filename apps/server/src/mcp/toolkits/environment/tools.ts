import {
  BackgroundActivityProfileSelection,
  ExecutionEnvironmentDescriptor,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  ServerSettings,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerEnvironment from "../../../environment/ServerEnvironment.ts";
import * as Keybindings from "../../../keybindings.ts";
import * as ThreadCommandExecutor from "../../../orchestration-v2/ThreadCommandExecutor.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const PreferenceFields = {
  defaultThreadEnvMode: ServerSettings.fields.defaultThreadEnvMode,
  newWorktreesStartFromOrigin: ServerSettings.fields.newWorktreesStartFromOrigin,
  enableProviderUpdateChecks: ServerSettings.fields.enableProviderUpdateChecks,
  backgroundActivity: Schema.Struct({ profile: BackgroundActivityProfileSelection }),
  sourceControlWritingStyle: Schema.Struct({
    mode: Schema.String,
    followChangeRequestTemplates: Schema.Boolean,
    customInstructions: Schema.String,
    truncated: Schema.Boolean,
  }),
};
const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerEnvironment.ServerEnvironment,
    Settings.ServerSettingsService,
    Keybindings.Keybindings,
    ThreadCommandExecutor.ThreadCommandExecutor,
  ],
};
// Settings and keybindings travel as plain JSON; their full schemas would bloat every tool list.
const SettingsObject = Schema.Record(Schema.String, Schema.Unknown);
const KeybindingFields = {
  key: Schema.String.annotate({
    description: 'e.g. "mod+shift+k"; mod is cmd on macOS, ctrl elsewhere.',
  }),
  command: Schema.String.annotate({ description: "From `t3_keybindings_read`." }),
  when: Schema.optionalKey(Schema.String.annotate({ description: 'e.g. "!terminalFocus".' })),
};
const KeybindingRuleView = Schema.Struct({
  key: Schema.String,
  command: Schema.String,
  when: Schema.optionalKey(Schema.String),
});

const EnvironmentReadTool = Tool.make("t3_environment_read", {
  ...shared,
  description:
    "Read this server's identity and preferences. Providers and models: `orchestrator_capabilities`.",
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.Struct({
    environmentId: ExecutionEnvironmentDescriptor.fields.environmentId,
    label: Schema.String,
    serverVersion: Schema.String,
    platform: ExecutionEnvironmentDescriptor.fields.platform,
    preferences: Schema.Struct(PreferenceFields),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const SettingsReadTool = Tool.make("t3_environment_settings_read", {
  ...shared,
  description:
    "Read this server's settings, as on the Settings page. Secrets come back redacted. Pass `keys` to read only some.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    keys: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  success: Schema.Struct({ settings: SettingsObject }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const SettingsUpdateTool = Tool.make("t3_environment_settings_update", {
  ...shared,
  description:
    "Change this server's settings. `patch` uses the keys and shapes of `t3_environment_settings_read`; omitted keys are unchanged. Live full-access or default caller thread only. Agent browser and device access stay the user's to grant.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    patch: SettingsObject,
  }),
  success: Schema.Struct({ settings: SettingsObject }),
}).annotate(Tool.Destructive, true);
const KeybindingsReadTool = Tool.make("t3_keybindings_read", {
  ...shared,
  description: "List this server's keyboard shortcuts and every command a shortcut can run.",
  parameters: Schema.Struct({ environmentId: OrchestratorMcpEnvironmentTarget }),
  success: Schema.Struct({
    keybindings: Schema.Array(KeybindingRuleView),
    commands: Schema.Array(Schema.String),
    issues: Schema.Array(Schema.String),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const KeybindingUpsertTool = Tool.make("t3_keybinding_upsert", {
  ...shared,
  description:
    "Add a keyboard shortcut, or change one by passing the current binding as `replace`. Live full-access or default caller thread only.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...KeybindingFields,
    replace: Schema.optionalKey(Schema.Struct(KeybindingFields)),
  }),
  success: Schema.Struct({ keybindings: Schema.Array(KeybindingRuleView) }),
}).annotate(Tool.Destructive, true);
const KeybindingRemoveTool = Tool.make("t3_keybinding_remove", {
  ...shared,
  description:
    "Remove a keyboard shortcut, matched exactly as `t3_keybindings_read` lists it. Live full-access or default caller thread only.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...KeybindingFields,
  }),
  success: Schema.Struct({ keybindings: Schema.Array(KeybindingRuleView) }),
}).annotate(Tool.Destructive, true);
export const EnvironmentToolkit = Toolkit.make(
  EnvironmentReadTool,
  SettingsReadTool,
  SettingsUpdateTool,
  KeybindingsReadTool,
  KeybindingUpsertTool,
  KeybindingRemoveTool,
);
