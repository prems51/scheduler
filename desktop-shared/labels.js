// labels.js — the ONE place that turns a section + batch number into the text
// the department sheet uses. Batches are not stored with a name: they are
// derived from the section (section A -> A1/A2, section B -> B1/B2), so every
// screen, conflict message, workbook and PDF must come through here.

/**
 * "A" + 1 -> "A1". A whole-section slot (batchNo null) keeps just the section.
 * @param {string} sectionName e.g. "B"
 * @param {number|null|undefined} batchNo 1 or 2, null for the whole section
 */
export function batchLabel(sectionName, batchNo) {
  const name = String(sectionName ?? '').trim()
  const number = Number(batchNo)
  if (batchNo === null || batchNo === undefined || batchNo === '' || !Number.isFinite(number)) {
    return name
  }
  return `${name}${number}`
}

/**
 * Short "where is this class" label used by generated views and cell text:
 *   whole section -> "5-B"      batch -> "5-B1"
 */
export function sectionCodeLabel(semester, sectionName, batchNo) {
  const semesterText = String(semester ?? '').trim()
  const hasBatch = batchNo !== null && batchNo !== undefined && batchNo !== ''
  if (!hasBatch) return `${semesterText}-${String(sectionName ?? '').trim()}`
  return `${semesterText}-${batchLabel(sectionName, batchNo)}`
}

/**
 * Long label for conflict messages and the merge offer:
 *   whole section -> "Sem 5-B"   batch -> "Sem 5 - B1"
 */
export function sectionLabel(semester, sectionName, batchNo) {
  const semesterText = String(semester ?? '').trim()
  const hasBatch = batchNo !== null && batchNo !== undefined && batchNo !== ''
  if (!hasBatch) return `Sem ${semesterText}-${String(sectionName ?? '').trim()}`
  return `Sem ${semesterText} - ${batchLabel(sectionName, batchNo)}`
}
