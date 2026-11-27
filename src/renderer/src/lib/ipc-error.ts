/** Strips Electron's "Error invoking remote method '…': Error: " wrapper from a rejected IPC call. */
export function ipcErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
