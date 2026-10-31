// ipcEnvelope.js — the one answer-shape every IPC handler uses:
//   { ok: true, data }              on success
//   { ok: false, error, ...extra }  on failure
// Living outside the electron-importing ipc.js so tests can drive the exact
// envelope a renderer receives, with the real handler functions and a real
// better-sqlite3 database (round-4 Issue 2).

/** Turns a raw SQLite/Node error into something a professor can read. */
export function humanizeError(error) {
  const message = String((error && error.message) || error || 'Unknown error')

  if (/UNIQUE constraint failed: ([a-z_]+)\.([a-z_]+)/i.test(message)) {
    const [, table, column] = message.match(/UNIQUE constraint failed: ([a-z_]+)\.([a-z_]+)/i)
    return `That ${column} is already used by another ${table.replace(/s$/, '').replace(/_/g, ' ')}.`
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return 'This record is still used by other data, so it cannot be changed or deleted.'
  }
  if (/CHECK constraint failed/i.test(message)) {
    return 'Some of these values are not allowed (check the day, period, span and kind).'
  }
  if (/NOT NULL constraint failed: ([a-z_]+)\.([a-z_]+)/i.test(message)) {
    const [, , column] = message.match(/NOT NULL constraint failed: ([a-z_]+)\.([a-z_]+)/i)
    return `${column.replace(/_/g, ' ')} is required.`
  }
  return message
}

/**
 * Runs one handler body and folds its outcome (or its exception) into the
 * envelope. User errors may carry `extra` (e.g. `problems`) which is merged
 * into the failed envelope so the renderer can show every conflict.
 * @param {() => any|Promise<any>} fn
 */
export async function toEnvelope(fn) {
  try {
    const data = await fn()
    return { ok: true, data }
  } catch (error) {
    const message = (error && error.userMessage) || humanizeError(error)
    const response = { ok: false, error: message }
    if (error && error.extra) Object.assign(response, error.extra)
    return response
  }
}
