/**
 * Vim keys for the composer over plain text: lines end with "\n" and a chip is
 * one character. Pure; the editor applies the returned steps to its document.
 */

export type VimMode = "insert" | "normal";

export const VIM_CHIP = "\uFFFC";

type Operator = "d" | "c" | "y";
type FindKind = "f" | "F" | "t" | "T";

export interface VimRegister {
  readonly text: string;
  readonly linewise: boolean;
  /** Markdown for `text`, so a put restores chips and formatting. */
  readonly source?: string;
}

export interface VimState {
  readonly mode: VimMode;
  readonly pending: ReadonlyArray<string>;
  readonly register: VimRegister | null;
  readonly lastFind: { readonly kind: FindKind; readonly char: string } | null;
  readonly lastChange: { readonly keys: ReadonlyArray<string>; readonly inserted: string } | null;
  /** The command that entered insert mode and the text it left, completed into `lastChange` on Escape. */
  readonly insert: { readonly keys: ReadonlyArray<string>; readonly baseline: string } | null;
  /** Column kept across `j` and `k`; Infinity after `$`. */
  readonly column: number | null;
}

export const INITIAL_VIM_STATE: VimState = {
  mode: "insert",
  pending: [],
  register: null,
  lastFind: null,
  lastChange: null,
  insert: null,
  column: null,
};

/** Offsets refer to the text left by the previous step. Replace text never contains "\n". */
export type VimStep =
  | { readonly type: "replace"; readonly from: number; readonly to: number; readonly text: string }
  | { readonly type: "newline"; readonly at: number }
  | { readonly type: "put"; readonly at: number; readonly count: number };

export interface VimOutcome {
  readonly state: VimState;
  readonly steps: ReadonlyArray<VimStep>;
  /** Cursor in the text after the steps. */
  readonly cursor: number;
  /** Range of the text before the steps that the register now holds. */
  readonly yank?: { readonly from: number; readonly to: number };
  readonly history?: "undo" | "redo";
}

type Motion = { readonly key: string; readonly char?: string };
type Target = Motion | { readonly object: string } | "line";
type Command =
  | {
      readonly kind: "motion";
      readonly motion: Motion;
      readonly count: number;
      readonly counted: boolean;
    }
  | {
      readonly kind: "operator";
      readonly op: Operator;
      readonly target: Target;
      readonly count: number;
      readonly counted: boolean;
    }
  | {
      readonly kind: "action";
      readonly key: string;
      readonly char?: string;
      readonly count: number;
    };

const MOTION_KEYS = new Set([
  "h",
  "j",
  "k",
  "l",
  "w",
  "W",
  "b",
  "B",
  "e",
  "E",
  "0",
  "^",
  "$",
  "G",
  ";",
  ",",
]);
const MOTION_ALIASES: Record<string, string> = { " ": "l", "<BS>": "h" };
const FIND_KEYS = new Set(["f", "F", "t", "T"]);
const OBJECT_KEYS: Record<string, string> = {
  w: "w",
  W: "W",
  '"': '"',
  "'": "'",
  "`": "`",
  "(": "(",
  ")": "(",
  b: "(",
  "[": "[",
  "]": "[",
  "{": "{",
  "}": "{",
  B: "{",
};
// Shorthands for an operator and a target.
const SHORTHANDS: Record<string, { op: Operator; target: Target }> = {
  x: { op: "d", target: { key: "l" } },
  "<Del>": { op: "d", target: { key: "l" } },
  X: { op: "d", target: { key: "h" } },
  s: { op: "c", target: { key: "l" } },
  S: { op: "c", target: "line" },
  D: { op: "d", target: { key: "$" } },
  C: { op: "c", target: { key: "$" } },
  Y: { op: "y", target: "line" },
};
const ACTION_KEYS = new Set(["i", "a", "I", "A", "o", "O", "p", "P", "J", "u", "<C-r>", "."]);

function isSingleChar(key: string | undefined): key is string {
  return key !== undefined && key.length === 1;
}

function parseCommand(keys: ReadonlyArray<string>): Command | "incomplete" | "invalid" {
  let index = 0;
  const readCount = () => {
    let digits = "";
    while (index < keys.length && /^[0-9]$/.test(keys[index]!) && (digits || keys[index] !== "0")) {
      digits += keys[index++];
    }
    return digits ? Number(digits) : null;
  };
  // A motion, or "incomplete" while it waits for its character.
  const readMotion = (): Motion | "incomplete" | "invalid" => {
    if (index >= keys.length) return "incomplete";
    const raw = keys[index++]!;
    const key = MOTION_ALIASES[raw] ?? raw;
    if (MOTION_KEYS.has(key)) return { key };
    if (FIND_KEYS.has(key)) {
      if (index >= keys.length) return "incomplete";
      const char = keys[index++];
      return isSingleChar(char) ? { key, char } : "invalid";
    }
    if (key === "g") {
      if (index >= keys.length) return "incomplete";
      return keys[index++] === "g" ? { key: "gg" } : "invalid";
    }
    return "invalid";
  };

  const firstCount = readCount();
  if (index >= keys.length) return "incomplete";
  const key = keys[index]!;
  const shorthand = SHORTHANDS[key];
  if (shorthand) {
    return {
      kind: "operator",
      ...shorthand,
      count: firstCount ?? 1,
      counted: firstCount !== null,
    };
  }
  if (key === "d" || key === "c" || key === "y") {
    index += 1;
    const secondCount = readCount();
    const count = (firstCount ?? 1) * (secondCount ?? 1);
    const counted = firstCount !== null || secondCount !== null;
    if (index >= keys.length) return "incomplete";
    const next = keys[index]!;
    if (next === key) return { kind: "operator", op: key, target: "line", count, counted };
    if (next === "i" || next === "a") {
      index += 1;
      if (index >= keys.length) return "incomplete";
      const object = OBJECT_KEYS[keys[index]!];
      return object
        ? { kind: "operator", op: key, target: { object: next + object }, count, counted }
        : "invalid";
    }
    const motion = readMotion();
    if (typeof motion === "string") return motion;
    return { kind: "operator", op: key, target: motion, count, counted };
  }
  if (key === "r") {
    if (index + 1 >= keys.length) return "incomplete";
    const char = keys[index + 1];
    return isSingleChar(char) ? { kind: "action", key, char, count: firstCount ?? 1 } : "invalid";
  }
  if (ACTION_KEYS.has(key)) return { kind: "action", key, count: firstCount ?? 1 };
  const motion = readMotion();
  if (typeof motion === "string") return motion;
  return { kind: "motion", motion, count: firstCount ?? 1, counted: firstCount !== null };
}

function lineStart(text: string, position: number): number {
  return position <= 0 ? 0 : text.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(text: string, position: number): number {
  const end = text.indexOf("\n", position);
  return end === -1 ? text.length : end;
}

function isBlank(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

function firstNonBlank(text: string, position: number): number {
  const end = lineEnd(text, position);
  let index = lineStart(text, position);
  while (index < end && isBlank(text[index])) index += 1;
  return index;
}

/** Normal mode rests on a character, never after the last one in a line. */
export function clampNormalCursor(text: string, position: number): number {
  const bounded = Math.max(0, Math.min(position, text.length));
  const start = lineStart(text, bounded);
  const end = lineEnd(text, bounded);
  return end > start && bounded >= end ? end - 1 : bounded;
}

/** 0 blank, 1 word, 2 punctuation, 3 chip. A WORD is any run of non-blanks. */
function charClass(char: string | undefined, big: boolean): number {
  if (char === undefined || isBlank(char)) return 0;
  if (big) return 1;
  if (char === VIM_CHIP) return 3;
  return /[\p{L}\p{N}_]/u.test(char) ? 1 : 2;
}

/** Whether `char` continues a run of `kind`; every chip is a word of its own. */
function joins(kind: number, char: string | undefined, big: boolean): boolean {
  return kind !== 3 && charClass(char, big) === kind;
}

function nextWordStart(text: string, position: number, big: boolean): number {
  let index = position;
  const kind = charClass(text[index], big);
  if (kind !== 0) {
    index += 1;
    while (index < text.length && joins(kind, text[index], big)) index += 1;
  }
  while (index < text.length && isBlank(text[index])) {
    index += 1;
    // An empty line counts as a word.
    if (text[index] === "\n" && text[index - 1] === "\n") return index;
  }
  return index;
}

function previousWordStart(text: string, position: number, big: boolean): number {
  if (position <= 0) return 0;
  let index = position - 1;
  while (index > 0 && isBlank(text[index])) {
    if (text[index] === "\n" && text[index - 1] === "\n") return index;
    index -= 1;
  }
  const kind = charClass(text[index], big);
  if (kind !== 0) while (index > 0 && joins(kind, text[index - 1], big)) index -= 1;
  return index;
}

function wordEnd(text: string, position: number, big: boolean): number {
  let index = position + 1;
  while (index < text.length && isBlank(text[index])) index += 1;
  if (index >= text.length) return Math.max(position, text.length - 1);
  const kind = charClass(text[index], big);
  while (index + 1 < text.length && joins(kind, text[index + 1], big)) index += 1;
  return index;
}

function findInLine(
  text: string,
  cursor: number,
  kind: FindKind,
  char: string,
  count: number,
  repeat: boolean,
): number | null {
  if (kind === "f" || kind === "t") {
    const end = lineEnd(text, cursor);
    // Repeating `t` from just before a match would find that match again.
    let index = cursor + (kind === "t" && repeat ? 1 : 0);
    for (let step = 0; step < count; step += 1) {
      index = text.indexOf(char, index + 1);
      if (index === -1 || index >= end) return null;
    }
    return kind === "f" ? index : index - 1;
  }
  const start = lineStart(text, cursor);
  let index = cursor - (kind === "T" && repeat ? 1 : 0);
  for (let step = 0; step < count; step += 1) {
    if (index - 1 < start) return null;
    index = text.lastIndexOf(char, index - 1);
    if (index < start) return null;
  }
  return kind === "F" ? index : index + 1;
}

const REVERSED_FIND: Record<FindKind, FindKind> = { f: "F", F: "f", t: "T", T: "t" };

type MotionResult = {
  position: number;
  type: "exclusive" | "inclusive" | "linewise";
  column?: number;
  lastFind?: VimState["lastFind"];
};

function lineIndexStart(text: string, line: number): number {
  let start = 0;
  for (let index = 0; index < line; index += 1) {
    const end = text.indexOf("\n", start);
    if (end === -1) return start;
    start = end + 1;
  }
  return start;
}

function motionTarget(
  state: VimState,
  text: string,
  cursor: number,
  motion: Motion,
  count: number,
  counted: boolean,
): MotionResult | null {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const repeatWord = (step: (position: number) => number) => {
    let position = cursor;
    for (let index = 0; index < count; index += 1) position = step(position);
    return position;
  };
  switch (motion.key) {
    case "h":
      return { position: Math.max(start, cursor - count), type: "exclusive" };
    case "l":
      return { position: Math.min(end, cursor + count), type: "exclusive" };
    case "0":
      return { position: start, type: "exclusive" };
    case "^":
      return { position: firstNonBlank(text, cursor), type: "exclusive" };
    case "$": {
      let lineEndPosition = end;
      for (let index = 1; index < count && lineEndPosition < text.length; index += 1) {
        lineEndPosition = lineEnd(text, lineEndPosition + 1);
      }
      return { position: lineEndPosition, type: "exclusive", column: Infinity };
    }
    case "w":
    case "W":
      return {
        position: repeatWord((position) => nextWordStart(text, position, motion.key === "W")),
        type: "exclusive",
      };
    case "b":
    case "B":
      return {
        position: repeatWord((position) => previousWordStart(text, position, motion.key === "B")),
        type: "exclusive",
      };
    case "e":
    case "E":
      return {
        position: repeatWord((position) => wordEnd(text, position, motion.key === "E")),
        type: "inclusive",
      };
    case "j":
    case "k": {
      const column = state.column ?? cursor - start;
      let targetStart = start;
      let moved = 0;
      for (; moved < count; moved += 1) {
        if (motion.key === "j") {
          const targetEnd = lineEnd(text, targetStart);
          if (targetEnd >= text.length) break;
          targetStart = targetEnd + 1;
        } else {
          if (targetStart === 0) break;
          targetStart = lineStart(text, targetStart - 1);
        }
      }
      if (moved === 0) return null;
      const targetEnd = lineEnd(text, targetStart);
      return {
        position: Math.min(targetStart + column, Math.max(targetStart, targetEnd - 1)),
        type: "linewise",
        column,
      };
    }
    case "G":
    case "gg": {
      const lines = text.split("\n").length;
      const line = counted ? Math.min(count, lines) - 1 : motion.key === "G" ? lines - 1 : 0;
      return { position: firstNonBlank(text, lineIndexStart(text, line)), type: "linewise" };
    }
    case ";":
    case ",": {
      const last = state.lastFind;
      if (!last) return null;
      const kind = motion.key === ";" ? last.kind : REVERSED_FIND[last.kind];
      const position = findInLine(text, cursor, kind, last.char, count, true);
      if (position === null) return null;
      return { position, type: kind === "f" || kind === "t" ? "inclusive" : "exclusive" };
    }
    default: {
      const kind = motion.key as FindKind;
      const char = motion.char!;
      const position = findInLine(text, cursor, kind, char, count, false);
      if (position === null) return null;
      return {
        position,
        type: kind === "f" || kind === "t" ? "inclusive" : "exclusive",
        lastFind: { kind, char },
      };
    }
  }
}

function wordObject(text: string, cursor: number, around: boolean, big: boolean) {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  if (start === end) return null;
  const position = Math.min(cursor, end - 1);
  const kind = charClass(text[position], big);
  let from = position;
  let to = position + 1;
  while (from > start && joins(kind, text[from - 1], big)) from -= 1;
  while (to < end && joins(kind, text[to], big)) to += 1;
  if (!around) return { from, to };
  if (kind === 0) {
    const next = charClass(text[to], big);
    if (to < end && next !== 0) {
      to += 1;
      while (to < end && joins(next, text[to], big)) to += 1;
    }
  } else if (to < end && isBlank(text[to])) {
    while (to < end && isBlank(text[to])) to += 1;
  } else {
    while (from > start && isBlank(text[from - 1])) from -= 1;
  }
  return { from, to };
}

function quoteObject(text: string, cursor: number, quote: string, around: boolean) {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const quotes: number[] = [];
  for (let index = start; index < end; index += 1) {
    if (text[index] === quote && text[index - 1] !== "\\") quotes.push(index);
  }
  // Quotes pair up from the start of the line.
  for (let index = 0; index + 1 < quotes.length; index += 2) {
    const open = quotes[index]!;
    const close = quotes[index + 1]!;
    if (cursor > close) continue;
    if (!around) return { from: open + 1, to: close };
    let from = open;
    let to = close + 1;
    if (to < end && isBlank(text[to])) {
      while (to < end && isBlank(text[to])) to += 1;
    } else {
      while (from > start && isBlank(text[from - 1])) from -= 1;
    }
    return { from, to };
  }
  return null;
}

const BRACKET_CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function bracketObject(text: string, cursor: number, open: string, around: boolean) {
  const close = BRACKET_CLOSE[open]!;
  let from = -1;
  let depth = 0;
  for (let index = text[cursor] === close ? cursor - 1 : cursor; index >= 0; index -= 1) {
    const char = text[index];
    if (char === close) depth += 1;
    else if (char === open) {
      if (depth === 0) {
        from = index;
        break;
      }
      depth -= 1;
    }
  }
  if (from === -1) return null;
  let to = -1;
  depth = 0;
  for (let index = from + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) depth += 1;
    else if (char === close) {
      if (depth === 0) {
        to = index;
        break;
      }
      depth -= 1;
    }
  }
  if (to === -1) return null;
  if (around) return { from, to: to + 1 };
  let innerFrom = from + 1;
  let innerTo = to;
  // A block that opens and closes on its own lines keeps those lines.
  if (text[innerFrom] === "\n") innerFrom += 1;
  const lastBreak = text.lastIndexOf("\n", innerTo - 1);
  if (lastBreak >= innerFrom && /^\s*$/.test(text.slice(lastBreak, innerTo))) innerTo = lastBreak;
  return { from: innerFrom, to: Math.max(innerFrom, innerTo) };
}

function textObject(text: string, cursor: number, object: string) {
  const around = object[0] === "a";
  const kind = object.slice(1);
  if (kind === "w" || kind === "W") return wordObject(text, cursor, around, kind === "W");
  if (kind === '"' || kind === "'" || kind === "`") return quoteObject(text, cursor, kind, around);
  return bracketObject(text, cursor, kind, around);
}

/** End (inclusive) of `cw`, which changes to the end of the word under the cursor. */
function changeWordEnd(text: string, cursor: number, count: number, big: boolean): number {
  const kind = charClass(text[cursor], big);
  let end = cursor;
  while (end + 1 < text.length && joins(kind, text[end + 1], big)) end += 1;
  for (let index = 1; index < count; index += 1) end = wordEnd(text, end, big);
  return end;
}

export function registerText(register: Pick<VimRegister, "linewise">, text: string, count: number) {
  return Array.from({ length: count }, () => text).join(register.linewise ? "\n" : "");
}

export function applyVimSteps(
  text: string,
  steps: ReadonlyArray<VimStep>,
  register: VimRegister | null,
): string {
  let next = text;
  for (const step of steps) {
    if (step.type === "replace") {
      next = next.slice(0, step.from) + step.text + next.slice(step.to);
    } else if (step.type === "newline") {
      next = `${next.slice(0, step.at)}\n${next.slice(step.at)}`;
    } else if (register) {
      next =
        next.slice(0, step.at) +
        registerText(register, register.text, step.count) +
        next.slice(step.at);
    }
  }
  return next;
}

/** The text typed into `baseline` to produce `text`, or null when it was not a plain insertion. */
function insertedText(baseline: string, text: string): string | null {
  const shortest = Math.min(baseline.length, text.length);
  let prefix = 0;
  while (prefix < shortest && baseline[prefix] === text[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    baseline[baseline.length - 1 - suffix] === text[text.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (prefix + suffix !== baseline.length) return null;
  const inserted = text.slice(prefix, text.length - suffix);
  return inserted.includes(VIM_CHIP) ? null : inserted;
}

/** Steps that type `text` at `at`, splitting lines the way Enter would. */
function typingSteps(at: number, text: string): VimStep[] {
  const steps: VimStep[] = [];
  let position = at;
  text.split("\n").forEach((line, index) => {
    if (index > 0) {
      steps.push({ type: "newline", at: position });
      position += 1;
    }
    if (line) steps.push({ type: "replace", from: position, to: position, text: line });
    position += line.length;
  });
  return steps;
}

function escapeCursor(text: string, cursor: number): number {
  return Math.max(lineStart(text, cursor), cursor - 1);
}

/** Leaves insert mode: the cursor steps back onto the last typed character. */
export function vimEscape(
  state: VimState,
  text: string,
  cursor: number,
): { state: VimState; cursor: number } {
  const lastChange = state.insert
    ? { keys: state.insert.keys, inserted: insertedText(state.insert.baseline, text) ?? "" }
    : state.lastChange;
  return {
    state: { ...state, mode: "normal", pending: [], insert: null, column: null, lastChange },
    cursor: escapeCursor(text, cursor),
  };
}

function operate(
  state: VimState,
  keys: ReadonlyArray<string>,
  text: string,
  cursor: number,
  op: Operator,
  target: Target,
  count: number,
  counted: boolean,
): VimOutcome | null {
  let from: number;
  let to: number;
  let linewise = false;
  let lastFind = state.lastFind;
  if (target === "line") {
    from = lineStart(text, cursor);
    to = lineEnd(text, cursor);
    for (let index = 1; index < count && to < text.length; index += 1) to = lineEnd(text, to + 1);
    linewise = true;
  } else if ("object" in target) {
    const range = textObject(text, cursor, target.object);
    if (!range) return null;
    ({ from, to } = range);
  } else if (
    op === "c" &&
    (target.key === "w" || target.key === "W") &&
    !isBlank(text[cursor]) &&
    cursor < text.length
  ) {
    from = cursor;
    to = changeWordEnd(text, cursor, count, target.key === "W") + 1;
  } else {
    const motion = motionTarget(state, text, cursor, target, count, counted);
    if (!motion) return null;
    lastFind = motion.lastFind ?? lastFind;
    from = Math.min(cursor, motion.position);
    to = Math.max(cursor, motion.position);
    if (motion.type === "linewise") {
      from = lineStart(text, from);
      to = lineEnd(text, to);
      linewise = true;
    } else if (motion.type === "inclusive") {
      to = Math.min(text.length, to + 1);
    } else if (target.key === "w" || target.key === "W") {
      // A word motion that crosses into the next line stops at the end of this one.
      const lastBreak = text.lastIndexOf("\n", to - 1);
      if (lastBreak >= from) to = lastBreak;
    }
  }

  if (from === to && !linewise && op !== "c") return null;
  const register: VimRegister = { text: text.slice(from, to), linewise };
  const yank = { from, to };
  const base: VimState = { ...state, register, lastFind, column: null };
  if (op === "y") {
    const position = linewise && lineStart(text, cursor) === from ? cursor : from;
    return { state: base, steps: [], cursor: clampNormalCursor(text, position), yank };
  }
  if (op === "c") {
    const steps: VimStep[] = from === to ? [] : [{ type: "replace", from, to, text: "" }];
    return {
      state: {
        ...base,
        mode: "insert",
        insert: { keys, baseline: applyVimSteps(text, steps, register) },
      },
      steps,
      cursor: from,
      yank,
    };
  }
  let deleteFrom = from;
  let deleteTo = to;
  if (linewise) {
    if (to < text.length) deleteTo = to + 1;
    else if (from > 0) deleteFrom = from - 1;
  }
  const steps: VimStep[] = [{ type: "replace", from: deleteFrom, to: deleteTo, text: "" }];
  const next = applyVimSteps(text, steps, register);
  return {
    state: { ...base, lastChange: { keys, inserted: "" } },
    steps,
    cursor: linewise
      ? firstNonBlank(next, Math.min(deleteFrom, next.length))
      : clampNormalCursor(next, from),
    yank,
  };
}

function act(
  state: VimState,
  keys: ReadonlyArray<string>,
  text: string,
  cursor: number,
  key: string,
  count: number,
  char: string | undefined,
): VimOutcome | null {
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);
  const enterInsert = (position: number, steps: VimStep[] = []): VimOutcome => ({
    state: {
      ...state,
      mode: "insert",
      column: null,
      insert: { keys, baseline: applyVimSteps(text, steps, state.register) },
    },
    steps,
    cursor: position,
  });
  const change = (steps: VimStep[], position: number): VimOutcome => ({
    state: { ...state, column: null, lastChange: { keys, inserted: "" } },
    steps,
    cursor: clampNormalCursor(applyVimSteps(text, steps, state.register), position),
  });
  switch (key) {
    case "i":
      return enterInsert(cursor);
    case "a":
      return enterInsert(Math.min(cursor + 1, end));
    case "I":
      return enterInsert(firstNonBlank(text, cursor));
    case "A":
      return enterInsert(end);
    case "o":
      return enterInsert(end + 1, [{ type: "newline", at: end }]);
    case "O":
      return enterInsert(start, [{ type: "newline", at: start }]);
    case "u":
      return { state, steps: [], cursor, history: "undo" };
    case "<C-r>":
      return { state, steps: [], cursor, history: "redo" };
    case "p":
    case "P": {
      const register = state.register;
      if (!register) return null;
      if (register.linewise) {
        const at = key === "p" ? end : start;
        const lineAt = key === "p" ? end + 1 : start;
        const steps: VimStep[] = [
          { type: "newline", at },
          { type: "put", at: lineAt, count },
        ];
        return change(steps, firstNonBlank(applyVimSteps(text, steps, register), lineAt));
      }
      const at = key === "p" ? Math.min(cursor + 1, end) : cursor;
      return change([{ type: "put", at, count }], at + register.text.length * count - 1);
    }
    case "J": {
      let next = text;
      let position = cursor;
      const steps: VimStep[] = [];
      for (let join = 0; join < Math.max(1, count - 1); join += 1) {
        const joinAt = lineEnd(next, position);
        if (joinAt >= next.length) break;
        let contentStart = joinAt + 1;
        while (
          contentStart < next.length &&
          next[contentStart] !== "\n" &&
          isBlank(next[contentStart])
        ) {
          contentStart += 1;
        }
        const separator =
          joinAt === lineStart(next, joinAt) ||
          isBlank(next[joinAt - 1]) ||
          contentStart >= next.length ||
          next[contentStart] === "\n" ||
          next[contentStart] === ")"
            ? ""
            : " ";
        const step: VimStep = { type: "replace", from: joinAt, to: contentStart, text: separator };
        steps.push(step);
        next = applyVimSteps(next, [step], null);
        position = joinAt;
      }
      if (steps.length === 0) return null;
      return change(steps, position);
    }
    case "r": {
      if (cursor + count > end || !char) return null;
      return change(
        [{ type: "replace", from: cursor, to: cursor + count, text: char.repeat(count) }],
        cursor + count - 1,
      );
    }
    case ".": {
      const last = state.lastChange;
      if (!last) return null;
      const replay = run({ ...state, pending: [] }, last.keys, text, cursor);
      if (!replay) return null;
      if (replay.state.mode !== "insert")
        return { ...replay, state: { ...replay.state, lastChange: last } };
      const steps = [...replay.steps];
      const typed = typingSteps(replay.cursor, last.inserted);
      const previous = steps.at(-1);
      const first = typed[0];
      // Merge the deletion and the typing so one undo reverts the repeat.
      if (
        previous?.type === "replace" &&
        first?.type === "replace" &&
        previous.from + previous.text.length === first.from
      ) {
        steps[steps.length - 1] = { ...previous, text: previous.text + first.text };
        typed.shift();
      }
      steps.push(...typed);
      const next = applyVimSteps(text, steps, replay.state.register);
      return {
        ...replay,
        state: { ...replay.state, mode: "normal", insert: null, lastChange: last },
        steps,
        cursor: escapeCursor(next, replay.cursor + last.inserted.length),
      };
    }
    default:
      return null;
  }
}

function run(
  state: VimState,
  keys: ReadonlyArray<string>,
  text: string,
  cursor: number,
): VimOutcome | null {
  const command = parseCommand(keys);
  if (typeof command === "string") return null;
  if (command.kind === "operator") {
    return operate(
      state,
      keys,
      text,
      cursor,
      command.op,
      command.target,
      command.count,
      command.counted,
    );
  }
  if (command.kind === "action") {
    return act(state, keys, text, cursor, command.key, command.count, command.char);
  }
  const motion = motionTarget(state, text, cursor, command.motion, command.count, command.counted);
  if (!motion) return null;
  return {
    state: { ...state, column: motion.column ?? null, lastFind: motion.lastFind ?? state.lastFind },
    steps: [],
    cursor: clampNormalCursor(text, motion.position),
  };
}

/**
 * Handles one key in normal mode. `key` is a single character, or `<BS>`, `<Del>` or `<C-r>`.
 * Unknown or failed commands are swallowed without changes, like Vim's beep.
 */
export function vimNormalKey(
  state: VimState,
  key: string,
  text: string,
  cursor: number,
): VimOutcome {
  const keys = [...state.pending, key];
  const parsed = parseCommand(keys);
  if (parsed === "incomplete") return { state: { ...state, pending: keys }, steps: [], cursor };
  const idle = { ...state, pending: [] };
  if (parsed === "invalid") return { state: idle, steps: [], cursor };
  return run(idle, keys, text, cursor) ?? { state: idle, steps: [], cursor };
}
