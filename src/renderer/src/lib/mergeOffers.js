/**
 * Turns the conflict problems of the slot editor into the merge offer UI.
 *
 * One merge candidate means the click can fully resolve the clash — one
 * button. Candidates from two different slots (say the teacher clash points at
 * 5-A and the venue clash at 5-C) cannot both be resolved by joining one merged
 * lecture, so no button is offered and the reason is explained instead.
 *
 * Pure function; see tests/merge-offers.test.js.
 */
export function mergeOfferState(problems) {
  const bySlot = new Map()
  for (const problem of problems ?? []) {
    if (problem?.merge && problem.merge_timing_ok && !bySlot.has(problem.merge.slot_id)) {
      bySlot.set(problem.merge.slot_id, problem.merge)
    }
  }

  const offers = [...bySlot.values()]
  if (offers.length <= 1) {
    return { offers, blockedNote: '' }
  }

  const role = (type) =>
    type === 'teacher' ? 'a teacher is busy' : type === 'venue' ? 'the venue is used' : 'it clashes'
  const parts = offers.map((offer) => {
    const problem = (problems ?? []).find(
      (entry) => entry?.merge && entry.merge.slot_id === offer.slot_id
    )
    return `${role(problem.type)} in ${offer.section ?? 'the other section'}`
  })
  const blockedNote = `A merged lecture can adopt only one schedule: ${parts.join(
    ' and '
  )} — one merge cannot resolve both. Pick the slot you can merge with, or change the teacher or venue.`

  return { offers: [], blockedNote }
}
