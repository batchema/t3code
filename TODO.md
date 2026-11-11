# TODO

- [x] **Vim motions in the composer.** An opt-in vim mode for the chat input, like Claude Code's
      `/vim`: normal and insert modes, common motions (`hjkl`, `w`/`b`/`e`, `0`/`$`, `gg`/`G`),
      operators (`d`, `c`, `y`) with motions and text objects, and a visible mode indicator.
- [x] **`ctrl+`` toggles the terminal.** Match VS Code: `ctrl+`` opens and closes the terminal
      drawer, alongside the existing `mod+j`, including while the terminal has focus.
- [ ] **Setting to hide thread details by default.** New threads always open the Thread Details
      card because `inlineOpen: true` is hardcoded in `apps/web/src/rightPanelStore.ts`. Add a
      setting such as "Show thread details in new threads" that feeds that default. Leave it on by
      default to match today's behavior. Toggling per thread (button or `mod+shift+b`) should keep
      working as it does now.
- [ ] **Agents can drive all of T3 Code.** Extend the T3 MCP server beyond orchestration
      (threads, projects, previews, devices) so agents can also control the app itself: settings,
      keybindings, panels and layout, navigation, and any action a user can trigger from the UI or
      command palette.
- [ ] **Agents know about linked environments.** Agents can't currently see the other machines
      linked to T3 Code (e.g. a devbox): the environment-listing MCP tool isn't exposed, so an
      agent only knows its own environment. Let agents list linked environments (label, platform,
      ID) when they need to, so they can act on or hand work off to another machine.
