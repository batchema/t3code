import { getClientSettings, updateClientSettings } from "../../hooks/useSettings";
import { toastManager } from "../ui/toast";

export function toggleComposerVimMode(): void {
  const enabled = !getClientSettings().composerVimMode;
  void updateClientSettings({ composerVimMode: enabled });
  toastManager.add({
    id: "composer-vim-mode",
    title: enabled ? "Vim mode on" : "Vim mode off",
    timeout: 1500,
  });
}
