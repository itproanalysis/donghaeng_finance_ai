import { createClientCommandId } from "./api-adapter";

export interface RecoveryCommandReceipt { key: string; body: Record<string, unknown> }

/** A state refresh must not turn an uncertain save into a second append-only record. */
export function recoveryCommand(previous: RecoveryCommandReceipt | null, action: string, values: Record<string, unknown>): RecoveryCommandReceipt {
  const intent = { ...values };
  delete intent.expectedRevision;
  const key = JSON.stringify({ action, ...intent });
  if (previous?.key === key) return previous;
  return { key, body: { action, ...values, clientCommandId: createClientCommandId("recovery") } };
}
