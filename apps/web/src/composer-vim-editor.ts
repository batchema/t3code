import { Extension } from "@tiptap/core";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import { type EditorState, Plugin, PluginKey, Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import {
  flatToPm,
  pmToFlat,
  type RichDocMap,
  serializeEditorDoc,
  serializeSelection,
} from "~/composer-rich-text-doc";
import {
  clampNormalCursor,
  registerText,
  VIM_CHIP,
  type VimMode,
  type VimOutcome,
  type VimState,
  vimEscape,
  vimNormalKey,
} from "~/composer-vim";

const vimPluginKey = new PluginKey<VimMode | null>("composer-vim");
const CURSOR_CLASS = "composer-vim-cursor";

/** The vim mode the editor shows, or null when vim mode is off. */
export function composerVimMode(state: EditorState): VimMode | null {
  return vimPluginKey.getState(state) ?? null;
}

export function showComposerVimMode(view: EditorView, mode: VimMode | null): void {
  if (composerVimMode(view.state) !== mode)
    view.dispatch(view.state.tr.setMeta(vimPluginKey, mode));
}

function emptyLineCursor(): HTMLElement {
  const cursor = document.createElement("span");
  cursor.className = `${CURSOR_CLASS} composer-vim-cursor-empty`;
  cursor.textContent = "\u00a0";
  return cursor;
}

/** Normal mode covers the character after the caret, or a placeholder cell at a line end. */
function blockCursor(state: EditorState): DecorationSet | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $head } = selection;
  const next = $head.nodeAfter;
  const decoration =
    next?.isText && next.text?.[0] !== "\n"
      ? Decoration.inline($head.pos, $head.pos + 1, { class: CURSOR_CLASS })
      : next?.isInline && !next.isText && next.type.name !== "hardBreak"
        ? Decoration.node($head.pos, $head.pos + next.nodeSize, { class: CURSOR_CLASS })
        : Decoration.widget($head.pos, emptyLineCursor, { key: CURSOR_CLASS, side: 1 });
  return DecorationSet.create(state.doc, [decoration]);
}

export const ComposerVimExtension = Extension.create({
  name: "composer-vim",
  addProseMirrorPlugins() {
    return [
      new Plugin<VimMode | null>({
        key: vimPluginKey,
        state: {
          init: () => null,
          apply: (tr, mode) => {
            const next = tr.getMeta(vimPluginKey) as VimMode | null | undefined;
            return next === undefined ? mode : next;
          },
        },
        props: {
          attributes: (state): Record<string, string> => {
            const mode = vimPluginKey.getState(state);
            return mode ? { "data-vim-mode": mode } : {};
          },
          decorations: (state) =>
            vimPluginKey.getState(state) === "normal" ? blockCursor(state) : null,
        },
      }),
    ];
  },
});

// The engine's text: one character per document position, so offsets are flat offsets.
const flatTexts = new WeakMap<RichDocMap, string>();

function flatText(map: RichDocMap): string {
  let text = flatTexts.get(map);
  if (text === undefined) {
    text = map.runs
      .map((run) => {
        if (run.kind === "token") return VIM_CHIP;
        if (run.kind === "break") return "\n";
        if (run.kind === "prefix") return "";
        const start = run.mdStart + run.openLen;
        return map.value.slice(start, start + run.docLen);
      })
      .join("");
    flatTexts.set(map, text);
  }
  return text;
}

export interface ComposerVimContext {
  readonly state: { current: VimState };
  readonly onModeChange: (mode: VimMode) => void;
  /** The composer's own Enter and Escape handling: sending, menus and suggestions. */
  readonly commandKey: (key: "Enter" | "Escape", event: KeyboardEvent) => boolean;
  /** Starts a new line at the selection the way a non-sending Enter does. */
  readonly insertNewline: (view: EditorView) => void;
  /** Inserts Markdown at the selection the way a paste does. */
  readonly insertMarkdown: (view: EditorView, markdown: string) => void;
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function engineKey(event: KeyboardEvent): string | null {
  if (event.metaKey) return null;
  if (event.ctrlKey) return !event.altKey && event.key.toLowerCase() === "r" ? "<C-r>" : null;
  if (event.key === "Backspace") return "<BS>";
  if (event.key === "Delete") return "<Del>";
  return event.key.length === 1 ? event.key : null;
}

function selectFlat(view: EditorView, offset: number) {
  const map = serializeEditorDoc(view.state.doc);
  return view.state.tr.setSelection(Selection.near(view.state.doc.resolve(flatToPm(map, offset))));
}

function placeCursor(view: EditorView, offset: number, mode: VimMode): void {
  const target =
    mode === "normal"
      ? clampNormalCursor(flatText(serializeEditorDoc(view.state.doc)), offset)
      : offset;
  const tr = selectFlat(view, target);
  // Same transaction as the move, so change handlers already see the new mode.
  if (composerVimMode(view.state) !== mode) tr.setMeta(vimPluginKey, mode);
  view.dispatch(tr.scrollIntoView());
}

function applyOutcome(view: EditorView, outcome: VimOutcome, context: ComposerVimContext): void {
  let state = outcome.state;
  if (outcome.yank && state.register) {
    const map = serializeEditorDoc(view.state.doc);
    const source = serializeSelection(
      view.state.doc,
      flatToPm(map, outcome.yank.from),
      flatToPm(map, outcome.yank.to),
    );
    state = { ...state, register: { ...state.register, source } };
  }
  context.state.current = state;
  if (state.pending.length > 0) return;
  if (outcome.history) {
    (outcome.history === "undo" ? undo : redo)(view.state, (tr) => view.dispatch(tr));
    const map = serializeEditorDoc(view.state.doc);
    placeCursor(view, pmToFlat(map, view.state.selection.head), "normal");
    return;
  }
  // Each command is its own undo step, even when typed within the grouping delay.
  if (outcome.steps.length > 0) view.dispatch(closeHistory(view.state.tr));
  for (const step of outcome.steps) {
    if (step.type === "replace") {
      const map = serializeEditorDoc(view.state.doc);
      const from = flatToPm(map, step.from);
      const to = flatToPm(map, step.to);
      view.dispatch(
        step.text ? view.state.tr.insertText(step.text, from, to) : view.state.tr.delete(from, to),
      );
      continue;
    }
    view.dispatch(selectFlat(view, step.at));
    if (step.type === "newline") {
      context.insertNewline(view);
    } else if (state.register) {
      const { register } = state;
      context.insertMarkdown(
        view,
        registerText(register, register.source ?? register.text, step.count),
      );
    }
  }
  placeCursor(view, outcome.cursor, state.mode);
  if (state.mode === "insert") context.onModeChange("insert");
}

/** Returns true when vim handled the key. Normal mode swallows every key that would type text. */
export function handleComposerVimKeyDown(
  view: EditorView,
  event: KeyboardEvent,
  context: ComposerVimContext,
): boolean {
  if (event.isComposing || event.keyCode === 229 || event.target !== view.dom) return false;
  const vim = context.state;
  if (vim.current.mode === "insert") {
    if (
      event.key !== "Escape" ||
      event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    ) {
      return false;
    }
    consume(event);
    // An open menu or suggestion closes first, like it does without vim.
    if (context.commandKey("Escape", event)) return true;
    const map = serializeEditorDoc(view.state.doc);
    const next = vimEscape(vim.current, flatText(map), pmToFlat(map, view.state.selection.head));
    vim.current = next.state;
    placeCursor(view, next.cursor, "normal");
    context.onModeChange("normal");
    return true;
  }
  if (event.key === "Escape") {
    // Without a pending command, Escape keeps its usual meaning.
    if (vim.current.pending.length === 0) return false;
    vim.current = { ...vim.current, pending: [] };
    consume(event);
    return true;
  }
  if (event.key === "Enter") {
    vim.current = { ...vim.current, pending: [] };
    context.commandKey("Enter", event);
    consume(event);
    return true;
  }
  const key = engineKey(event);
  if (key === null) return false;
  consume(event);
  const map = serializeEditorDoc(view.state.doc);
  const outcome = vimNormalKey(
    vim.current,
    key,
    flatText(map),
    pmToFlat(map, view.state.selection.head),
  );
  applyOutcome(view, outcome, context);
  return true;
}
