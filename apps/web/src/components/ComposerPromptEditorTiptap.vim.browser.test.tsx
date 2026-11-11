import type { Editor } from "@tiptap/core";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import {
  ComposerPromptEditorTiptap as ComposerPromptEditor,
  type ComposerPromptEditorHandle,
  type ComposerPromptEditorProps,
} from "./ComposerPromptEditorTiptap";

type VimProps = Pick<ComposerPromptEditorProps, "onCommandKeyDown" | "onVimModeChange">;

function VimComposer({ value, ...props }: VimProps & { value: string }) {
  const [prompt, setPrompt] = useState({ value, cursor: value.length });
  return (
    <ComposerPromptEditor
      editorRef={createRef<ComposerPromptEditorHandle>()}
      value={prompt.value}
      cursor={prompt.cursor}
      richTextEnabled
      vimEnabled
      contextRecords={new Map()}
      skills={[]}
      disabled={false}
      placeholder=""
      onChange={(...args) => setPrompt({ value: args[0], cursor: args[1] })}
      onPaste={() => {}}
      {...props}
    />
  );
}

async function mountVim(value: string, props: VimProps = {}) {
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(<VimComposer value={value} {...props} />));
  const element = screen.container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  const { editor } = element;
  editor.view.focus();
  const environment = stack.move();
  return Object.assign(screen, {
    [Symbol.asyncDispose]: () => environment.disposeAsync(),
    editor,
    text: () => serializeEditorDoc(editor.state.doc).value,
  });
}

describe("composer vim mode", () => {
  it("edits from normal mode and undoes one command at a time", async () => {
    await using screen = await mountVim("foo bar baz");
    await userEvent.keyboard("{Escape}");
    expect(screen.editor.view.dom.dataset.vimMode).toBe("normal");
    await userEvent.keyboard("0dwxq");
    expect(screen.text()).toBe("ar baz");
    await userEvent.keyboard("u");
    expect(screen.text()).toBe("bar baz");
    await userEvent.keyboard("u");
    expect(screen.text()).toBe("foo bar baz");
  });

  it("keeps chips when putting a yanked line", async () => {
    await using screen = await mountVim("see @a.md now\nnext");
    await userEvent.keyboard("{Escape}ggyyp");
    expect(screen.text()).toBe("see @a.md now\nsee @a.md now\nnext");
    let chips = 0;
    screen.editor.state.doc.descendants((node) => {
      if (node.type.name === "composer-mention") chips += 1;
    });
    expect(chips).toBe(2);
  });

  it("deletes, puts and joins lines across paragraphs", async () => {
    await using screen = await mountVim("a\nb\nc");
    await userEvent.keyboard("{Escape}ggjdd");
    expect(screen.text()).toBe("a\nc");
    await userEvent.keyboard("P");
    expect(screen.text()).toBe("a\nb\nc");
    await userEvent.keyboard("ggJ");
    expect(screen.text()).toBe("a b\nc");
    await userEvent.keyboard("0cwx{Escape}w.");
    expect(screen.text()).toBe("x x\nc");
    expect(screen.editor.view.dom.querySelector(".composer-vim-cursor")?.textContent).toBe("x");
  });

  it("continues a list when opening a line below an item", async () => {
    await using screen = await mountVim("- a\n- b");
    await userEvent.keyboard("{Escape}ggoc{Escape}");
    expect(screen.text()).toBe("- a\n- c\n- b");
  });

  it("sends with Enter from normal mode without adding a line", async () => {
    const onCommandKeyDown = vi.fn((key: string) => key === "Enter");
    await using screen = await mountVim("hello", { onCommandKeyDown });
    await userEvent.keyboard("{Escape}{Enter}");
    expect(onCommandKeyDown).toHaveBeenCalledWith("Enter", expect.anything());
    expect(screen.text()).toBe("hello");
  });

  it("lets an open menu take Escape before leaving insert mode", async () => {
    const onCommandKeyDown = vi.fn((key: string) => key === "Escape");
    const onVimModeChange = vi.fn();
    await using screen = await mountVim("@a", { onCommandKeyDown, onVimModeChange });
    await userEvent.keyboard("{Escape}");
    expect(onVimModeChange).not.toHaveBeenCalledWith("normal");
    onCommandKeyDown.mockReturnValue(false);
    await userEvent.keyboard("{Escape}");
    expect(onVimModeChange).toHaveBeenLastCalledWith("normal");
    expect(screen.editor.view.dom.dataset.vimMode).toBe("normal");
  });
});
