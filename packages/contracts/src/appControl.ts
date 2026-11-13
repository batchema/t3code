import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { STATIC_KEYBINDING_COMMANDS } from "./keybindings.ts";

/** These send what the user wrote or listen to them; only the user may trigger them. */
const USER_ONLY_COMMANDS = new Set<string>([
  "composer.sendAlternate",
  "composer.sendBackground",
  "composer.sendAndNewThread",
  "composer.dictation",
  "thread.steerQueuedMessage",
]);

/** Shortcut commands an agent may run in the user's window. */
const APP_COMMANDS = STATIC_KEYBINDING_COMMANDS.filter(
  (command) => !USER_ONLY_COMMANDS.has(command),
);
export const AppCommand = Schema.Literals(APP_COMMANDS);
export type AppCommand = typeof AppCommand.Type;

export const AppControlRequest = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  command: AppCommand,
});
export type AppControlRequest = typeof AppControlRequest.Type;

export const AppControlResponseInput = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  /** False when nothing in the window handles the command right now. */
  handled: Schema.Boolean,
});
export type AppControlResponseInput = typeof AppControlResponseInput.Type;
