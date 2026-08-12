import { StreamingSttError, type StreamingSttSession } from "./stt-adapter";

export function assertAudioFinalizationActive(options: {
  expectedController: AbortController | null;
  currentController: AbortController | null;
  signal?: AbortSignal;
}): AbortController {
  if (
    options.expectedController === null ||
    options.currentController !== options.expectedController ||
    options.expectedController.signal.aborted ||
    options.signal?.aborted
  ) {
    throw new StreamingSttError(
      "STT_SESSION_STOPPED",
      "A cancelled STT session cannot persist or publish a late transcript.",
      false,
    );
  }
  return options.expectedController;
}

export async function cancelAudioOperationImmediately(
  controller: AbortController | null,
  session: StreamingSttSession | null,
): Promise<void> {
  controller?.abort();
  try {
    await session?.stop();
  } catch {
    // Cancellation is authoritative even if the provider stop hook fails.
  }
}

export function shouldCancelAudioOperationOnSocketClose(options: {
  endTurnRequested: boolean;
  finalized: boolean;
  receivedAudioFrame: boolean;
}): boolean {
  return (
    !options.finalized &&
    (options.endTurnRequested || !options.receivedAudioFrame)
  );
}

export async function endTurnWithFailureCleanup(
  session: StreamingSttSession,
  cleanup: () => void | Promise<void>,
): Promise<void> {
  try {
    await session.endTurn();
  } catch (caught) {
    try {
      await cleanup();
    } catch {
      // Preserve the transcription failure while still attempting cleanup.
    }
    throw caught;
  }
}
