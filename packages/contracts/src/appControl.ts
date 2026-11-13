import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { STATIC_KEYBINDING_COMMANDS } from "./keybindings.ts";

/**
 * Only the user may trigger these: they send what the user wrote, listen to them, or pick
 * work that may belong to another environment (undo and reopen history, new threads, hosts).
 * Agents start threads with `t3_thread_launch` instead.
 */
const USER_ONLY_COMMANDS = new Set<string>([
  "composer.sendAlternate",
  "composer.sendBackground",
  "composer.sendAndNewThread",
  "composer.dictation",
  "composer.cycleHost",
  "thread.steerQueuedMessage",
  "thread.undo",
  "view.reopenClosed",
  "chat.new",
  "chat.newLocal",
  "chat.newWithoutProject",
]);

/**
 * These change only the window's own view, so they run on any screen. The rest act on the
 * thread or draft on screen, so they run only while it belongs to the agent's environment.
 */
export const VIEW_ONLY_APP_COMMANDS: ReadonlySet<string> = new Set([
  "sidebar.toggle",
  "navigation.back",
  "navigation.forward",
  "workspace.focusNext",
  "workspace.focusPrevious",
  "commandPalette.toggle",
  "theme.select",
  "appearance.cycle",
  "themeEditor.toggle",
  "thread.previous",
  "thread.next",
  "usage.open",
  "usage.cost",
  "usage.tokens",
  "usage.limits",
  "usage.period.day",
  "usage.period.week",
  "usage.period.month",
  "usage.period.quarter",
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
  /** The window isn't showing a thread or draft from the agent's environment. */
  "other-environment",
]);
export type AppControlResult = typeof AppControlResult.Type;

export const AppControlResponseInput = Schema.Struct({
  requestId: TrimmedNonEmptyString,
  result: AppControlResult,
});
export type AppControlResponseInput = typeof AppControlResponseInput.Type;
