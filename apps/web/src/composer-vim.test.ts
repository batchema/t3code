import { describe, expect, it } from "vite-plus/test";

import {
  applyVimSteps,
  INITIAL_VIM_STATE,
  type VimState,
  vimEscape,
  vimNormalKey,
} from "./composer-vim";

/** Runs keys from normal mode on `start`, where `|` marks the cursor; insert mode types text. */
function vim(start: string, keys: string, initial: Partial<VimState> = {}) {
  let text = start.replace("|", "");
  let cursor = start.indexOf("|");
  let state: VimState = { ...INITIAL_VIM_STATE, mode: "normal", ...initial };
  for (const key of keys.match(/<[^>]+>|[\s\S]/gu) ?? []) {
    if (state.mode === "insert") {
      if (key === "<Esc>") {
        ({ state, cursor } = vimEscape(state, text, cursor));
        continue;
      }
      const typed = key === "<CR>" ? "\n" : key;
      text = text.slice(0, cursor) + typed + text.slice(cursor);
      cursor += typed.length;
      continue;
    }
    const outcome = vimNormalKey(state, key, text, cursor);
    text = applyVimSteps(text, outcome.steps, outcome.state.register);
    state = outcome.state;
    cursor = outcome.cursor;
  }
  return `${text.slice(0, cursor)}|${text.slice(cursor)}`;
}

describe("vim motions", () => {
  it.each([
    ["|foo bar baz", "w", "foo |bar baz"],
    ["|foo bar baz", "2w", "foo bar |baz"],
    ["|foo.bar baz", "w", "foo|.bar baz"],
    ["|foo.bar baz", "W", "foo.bar |baz"],
    ["|foo\n\nbar", "w", "foo\n|\nbar"],
    ["|a ￼ b", "w", "a |￼ b"],
    ["|a ￼ b", "ww", "a ￼ |b"],
    ["|a ￼￼ b", "ww", "a ￼|￼ b"],
    ["foo bar |baz", "b", "foo |bar baz"],
    ["foo.bar |baz", "B", "|foo.bar baz"],
    ["foo\n|bar", "b", "|foo\nbar"],
    ["|foo bar", "e", "fo|o bar"],
    ["fo|o bar", "e", "foo ba|r"],
    ["|foo.bar", "E", "foo.ba|r"],
    ["foo b|ar", "0", "|foo bar"],
    ["  fo|o", "^", "  |foo"],
    ["|foo bar", "$", "foo ba|r"],
    ["a|b", "l", "a|b"],
    ["a\n|b", "h", "a\n|b"],
    ["|ab", " ", "a|b"],
    ["a|b", "<BS>", "|ab"],
    ["|abc\nde", "j", "abc\n|de"],
    ["ab|c\nde", "j", "abc\nd|e"],
    ["ab|c\nd\nxyz", "jj", "abc\nd\nxy|z"],
    ["|ab\nwxyz", "$j", "ab\nwxy|z"],
    ["ab\n|c", "k", "|ab\nc"],
    ["|ab", "j", "|ab"],
    ["a\nb\n|c", "gg", "|a\nb\nc"],
    ["|a\n  b\nc", "2G", "a\n  |b\nc"],
    ["|a\nb\nc", "G", "a\nb\n|c"],
    ["|a-b-c", "f-", "a|-b-c"],
    ["|a-b-c", "2f-", "a-b|-c"],
    ["|a-b-c", "f-;", "a-b|-c"],
    ["|a-b-c", "f-;,", "a|-b-c"],
    ["|a-b-c", "t-;", "a-|b-c"],
    ["a-b-|c", "F-", "a-b|-c"],
    ["a-b-|c", "T-", "a-b-|c"],
    ["|a\n-", "f-", "|a\n-"],
  ])("%j %j -> %j", (start, keys, expected) => {
    expect(vim(start, keys)).toBe(expected);
  });
});

describe("vim edits", () => {
  it.each([
    ["|foo bar", "x", "|oo bar"],
    ["fo|o", "x", "f|o"],
    ["|foo", "3x", "|"],
    ["foo |bar", "X", "foo|bar"],
    ["|foo bar baz", "dw", "|bar baz"],
    ["|foo bar baz", "d2w", "|baz"],
    ["|foo bar baz", "2dw", "|baz"],
    ["foo |bar\nbaz", "dw", "foo| \nbaz"],
    ["foo |bar baz", "db", "|bar baz"],
    ["|￼￼ b", "dw", "|￼ b"],
    ["|foo bar", "de", "| bar"],
    ["|foo bar", "cwxy<Esc>", "x|y bar"],
    ["foo |bar", "D", "foo| "],
    ["foo |bar", "Cqux<Esc>", "foo qu|x"],
    ["|abc", "sx<Esc>", "|xbc"],
    ["a\n|b\nc", "dd", "a\n|c"],
    ["a\nb\n|c", "dd", "a\n|b"],
    ["|a\nb\nc", "2dd", "|c"],
    ["  a\n|b", "dd", "  |a"],
    ["a\n|b\nc", "dj", "|a"],
    ["a\n|b\nc", "ccx<Esc>", "a\n|x\nc"],
    ["a\n|b\nc", "Sx<Esc>", "a\n|x\nc"],
    ["a b|c d", "f d0", "| d"],
    ["a\n|b\nc", "yyp", "a\nb\n|b\nc"],
    ["a\n|b\nc", "yyP", "a\n|b\nb\nc"],
    ["a\n|b", "Yp", "a\nb\n|b"],
    ["|a", "ddp", "\n|a"],
    ["|ab", "ylp", "a|ab"],
    ["|ab", "yl2p", "aa|ab"],
    ["|ab", "xp", "b|a"],
    ["|foo bar", "dwP", "foo| bar"],
    ["|foo bar", "yiwP", "fo|ofoo bar"],
    ["a|b\ncd", "J", "ab| cd"],
    ["a\n  b", "J", "a| b"],
    ["a \nb", "J", "a |b"],
    ["|a\nb\nc", "3J", "a b| c"],
    ["|abc", "rx", "|xbc"],
    ["|abc", "2rx", "x|xc"],
    ["|abc", "5rx", "|abc"],
    ["|ab", "ix<Esc>", "|xab"],
    ["|ab", "ax<Esc>", "a|xb"],
    ["  a|b", "Ix<Esc>", "  |xab"],
    ["|ab", "Ax<Esc>", "ab|x"],
    ["|a\nb", "ox<Esc>", "a\n|x\nb"],
    ["a\n|b", "Ox<Esc>", "a\n|x\nb"],
  ])("%j %j -> %j", (start, keys, expected) => {
    expect(vim(start, keys)).toBe(expected);
  });
});

describe("vim text objects", () => {
  it.each([
    ["foo |bar baz", "diw", "foo | baz"],
    ["foo |bar baz", "daw", "foo |baz"],
    ["foo |baz", "daw", "fo|o"],
    ["foo.b|ar baz", "diW", "| baz"],
    ["a ￼|￼ b", "diw", "a ￼| b"],
    ['say "hi |there" ok', 'di"', 'say "|" ok'],
    ['say "hi |there" ok', 'da"', "say |ok"],
    ['|say "hi"', 'ci"x<Esc>', 'say "|x"'],
    ["it's 'a|b'", "di'", "it's 'a|b'"],
    ["x 'a|b' y", "di'", "x '|' y"],
    ["foo(|a, (b))", "di(", "foo(|)"],
    ["foo(a, (|b))", "di(", "foo(a, (|))"],
    ["foo(a, (b)|)", "dib", "foo(|)"],
    ["foo(|a)", "da(", "fo|o"],
    ["foo(|a)", "ci)x<Esc>", "foo(|x)"],
    ["[a, |b]", "di[", "[|]"],
    ["{\n  |a\n}", "di{", "{\n|\n}"],
    ["{|a}", "daB", "|"],
    ["|none", "di(", "|none"],
  ])("%j %j -> %j", (start, keys, expected) => {
    expect(vim(start, keys)).toBe(expected);
  });
});

describe("vim repeat", () => {
  it.each([
    ["|a b c", "dw.", "|c"],
    ["|abcdef", "2x.", "|ef"],
    ["|foo foo", "cwbar<Esc>w.", "bar ba|r"],
    ["|a\nb", "oc<Esc>j.", "a\nc\nb\n|c"],
    ["|a\nb", "Ax<CR>y<Esc>j.", "ax\ny\nbx\n|y"],
    ["|abc", ".", "|abc"],
    ["|ab cd", "yw.", "|ab cd"],
  ])("%j %j -> %j", (start, keys, expected) => {
    expect(vim(start, keys)).toBe(expected);
  });
});

describe("vim state", () => {
  it("waits for the rest of a command", () => {
    const outcome = vimNormalKey({ ...INITIAL_VIM_STATE, mode: "normal" }, "d", "abc", 0);
    expect(outcome.state.pending).toEqual(["d"]);
    expect(outcome.steps).toEqual([]);
  });

  it("reports the yanked range so the editor can keep its Markdown", () => {
    const outcome = vimNormalKey(
      { ...INITIAL_VIM_STATE, mode: "normal", pending: ["d"] },
      "d",
      "a\n￼ b\nc",
      2,
    );
    expect(outcome.yank).toEqual({ from: 2, to: 5 });
    expect(outcome.state.register).toEqual({ text: "￼ b", linewise: true });
  });

  it("steps back onto the last typed character when leaving insert mode", () => {
    expect(vimEscape(INITIAL_VIM_STATE, "ab\ncd", 3)).toMatchObject({
      state: { mode: "normal" },
      cursor: 3,
    });
    expect(vimEscape(INITIAL_VIM_STATE, "ab", 2).cursor).toBe(1);
  });

  it("swallows unknown keys", () => {
    const outcome = vimNormalKey({ ...INITIAL_VIM_STATE, mode: "normal" }, "Q", "abc", 1);
    expect(outcome).toMatchObject({ steps: [], cursor: 1, state: { pending: [] } });
  });
});
