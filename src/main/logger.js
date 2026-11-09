// logger.js — writes main-process failures to userData/logs so a support call
// can ask for a file instead of a screenshot of the console.

import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let installed = false

function timestamp(now = new Date()) {
  return now.toISOString()
}

function dayStamp(now = new Date()) {
  return now.toISOString().slice(0, 10)
}

function describe(value) {
  if (value instanceof Error) {
    return `${value.name || 'Error'}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function append(scope, text) {
  try {
    const folder = join(app.getPath('userData'), 'logs')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, `app-${dayStamp()}.log`)
    const body = `\n[${timestamp()}] [${scope}]\n${text.slice(0, 30000)}\n`
    appendFileSync(file, body, 'utf8')
    return file
  } catch (logFailure) {
    // Logging must never be the reason the app fails.
    console.error('[log] could not write the log file:', logFailure)
    return null
  }
}

export function logInfo(scope, message, extra = null) {
  const details = extra === null ? '' : `\n${describe(extra)}`
  return append(scope, `${message}${details}`)
}

export function logError(scope, error, extra = null) {
  const details = extra === null ? '' : `\n${describe(extra)}`
  return append(scope, `${describe(error)}${details}`)
}

/** Process-level failures are logged instead of disappearing into the console. */
export function installErrorLogging() {
  if (installed) return
  installed = true

  process.on('uncaughtException', (error) => {
    logError('uncaughtException', error)
  })
  process.on('unhandledRejection', (reason) => {
    logError('unhandledRejection', reason)
  })
}
