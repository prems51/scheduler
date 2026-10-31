// exportResult.js — how the Export page turns one export result or failure
// into the on-screen message. Pure: no electron, no React, so the renderer
// code path (result.description / error text) can be unit-tested.
//
// Round-4 Issue 2: the old code referenced `response` after the per-entry
// loop, where the loop's own const had gone out of scope — every batch export
// crashed with "response is not defined" after the files were already on disk.
// The shape-building now happens here, from explicit arguments.

/** Bullet lines from a per-entry PDF render that had to shrink hard. */
export function shrinkWarnings(entries = []) {
  if (!entries?.length) return []
  return [
    'Note: ' +
      entries
        .map(
          ({ title, scale }) =>
            `${title} was scaled to ${Math.round(scale * 100)}% to fit one page`
        )
        .join('; ')
  ]
}

/**
 * Bullet lines for sheets the PDF exporter could not fit even after shrinking.
 * These are returned instead of silently clipping the footer, so the user is
 * told which entry needs a smaller legend or fewer counselors (round-4 Issue 3).
 */
export function footerWarnings(entries = []) {
  if (!entries?.length) return []
  return ['Warning: ' + entries.join('; ')]
}

/**
 * The success box of an export run.
 * @param {object} outcome
 * @param {'files'|'combined'} mode
 * @param {'excel'|'pdf'|'both'} format
 * @returns {{ title: string, dir: string, messages: string[] }}
 */
export function describeExportSuccess(outcome, mode, format) {
  const { dir, files = [], skipped = [], small = [], warnings = [], count = files.length } = outcome
  if (mode === 'combined') {
    const unit = format === 'pdf' ? 'page' : 'sheet'
    const saved = files.join(' and ')
    return {
      dir,
      title: format === 'pdf' ? 'Combined PDF saved' : 'Export saved',
      messages: [
        `${saved} — ${count} ${unit}${count === 1 ? '' : 's'} written.`,
        ...(skipped.length ? ['Skipped: ' + skipped.join('; ')] : []),
        ...shrinkWarnings(small),
        ...footerWarnings(warnings)
      ]
    }
  }

  return {
    dir,
    title: `Exported ${files.length} file${files.length === 1 ? '' : 's'}`,
    messages: [
      ...files.slice(0, 4),
      files.length > 4 ? `… and ${files.length - 4} more` : '',
      skipped.length ? 'Skipped: ' + skipped.join('; ') : '',
      ...shrinkWarnings(small),
      ...footerWarnings(warnings)
    ].filter(Boolean)
  }
}

/**
 * The error text of a failed export. `failedEntry` names the entry that
 * failed, `writtenFiles` lists everything that already reached disk, so the
 * user can tell what is missing from the folder.
 */
export function describeExportError(message, { failedEntry = '', writtenFiles = [] } = {}) {
  const entry = failedEntry ? `${failedEntry}: ${message}` : String(message ?? 'Unknown error')
  if (!writtenFiles.length) return entry
  return [entry, '', 'Files already written:', ...writtenFiles.map((file) => `  ${file}`)].join(
    '\n'
  )
}
