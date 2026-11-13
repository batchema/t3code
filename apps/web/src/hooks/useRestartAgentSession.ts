import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { toastManager } from "../components/ui/toast";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import type { Thread } from "../types";

/** Stops the thread's agent session so the next message starts fresh, with providers reloaded. */
export function useRestartAgentSession() {
  const stopThreadSession = useAtomCommand(threadEnvironment.stopSession, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const restart = async (
    thread: Pick<Thread, "environmentId" | "id" | "runtime" | "modelSelection" | "worktreePath">,
    workspaceRoot: string | null,
  ) => {
    const { environmentId } = thread;
    if (thread.runtime !== null) {
      const stopped = await stopThreadSession({ environmentId, input: { threadId: thread.id } });
      if (stopped._tag === "Failure") throw squashAtomCommandFailure(stopped);
    }
    toastManager.add({
      type: "success",
      title: "Agent session will restart",
      description: "Your next message starts a fresh session.",
    });
    if (workspaceRoot === null) return;
    const refreshed = await refreshProviders({
      environmentId,
      input: {
        instanceId: thread.runtime?.providerInstanceId ?? thread.modelSelection.instanceId,
        cwd: thread.worktreePath ?? workspaceRoot,
        fresh: true,
      },
    });
    if (refreshed._tag === "Failure") throw squashAtomCommandFailure(refreshed);
  };
  return (...args: Parameters<typeof restart>) =>
    restart(...args).catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to restart agent session",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
}
