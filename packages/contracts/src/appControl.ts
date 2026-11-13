import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { STATIC_KEYBINDING_COMMANDS } from "./keybindings.ts";

/**
 * Only the user may trigger these: they send what the user wrote, listen to them, or (undo)
 * replay actions that may belong to other environments.
 */
const USER_ONLY_COMMANDS = new Set<string>([
  "composer.sendAlternate",
  "composer.sendBackground",
  "composer.sendAndNewThread",
  "composer.dictation",
  "thread.steerQueuedMessage",
  "thread.undo",
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

export const AppControlSubscribeInput = Schema.Struct({
  /** Whether the window is in use as it subscribes, so a background reconnect is not. */
  focused: Schema.Boolean,
});
export type AppControlSubscribeInput = typeof AppControlSubscribeInput.Type;

export const AppControlResult = Schema.Literals([
  "ran",
  /** Nothing on screen handles the command right now. */
  "not-handled",
  /** The window shows another environment's thread; commands act only on their own. */
  "other-environment",
]);
export type AppControlResult = typeof AppControlResult.Type;

export const AppControlResponseInput = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  result: AppControlResult,
});
export type AppControlResponseInput = typeof AppControlResponseInput.Type;
