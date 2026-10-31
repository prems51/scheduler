/**
 * Venue state for the slot editor, kept as an explicit { id, touched } pair.
 *
 * Round-3 Issues 1 and 4: the editor could not tell "not chosen yet" (fill the
 * default rules) from "explicitly None" (must stay null) — `venue ?? default`
 * treated both alike, so an activity saved with no venue came back showing the
 * section's default venue, and switching kind never reset it either.
 *
 * Pure module; the rules are tested in tests/venue-state.test.js.
 */

/** One venue looks up as "this is a lab" in the venues list. */
function isLab(venues, id) {
  return venues.some((venue) => venue.id === id && venue.kind === 'lab')
}

function firstLab(venues) {
  const lab = venues.find((venue) => venue.kind === 'lab')
  return lab ? lab.id : null
}

function isActivityKind(kind) {
  return String(kind ?? '').toUpperCase() === 'ACTIVITY'
}

/**
 * Initial venue state when the editor opens.
 * - Editing or pasting an existing slot (any `slot` object): the slot's own
 *   venue wins, including "None" — it must survive reopen and paste.
 * - A fresh slot: kind rules fill nothing yet — a new Activity starts at None,
 *   a class starts at the section's default venue.
 */
export function initialVenueState(slot, section, _venues = [], kind = 'L') {
  if (slot) {
    return { id: slot.venue_id ?? null, touched: true }
  }
  return {
    id: isActivityKind(kind) ? null : section?.default_venue_id ?? null,
    touched: false
  }
}

/**
 * Venue state after the user switches kind in the same editor session.
 * - A manually chosen venue (touched) is never overridden.
 * - Untouched: Activity resets to None; a practical fills the first lab when
 *   the current venue is not a lab; L/T fill the section's default venue when
 *   there is none yet (e.g. coming back from an Activity).
 */
export function venueAfterKindChange(state, nextKind, section, venues = []) {
  const kind = String(nextKind ?? '').toUpperCase()

  if (state.touched) return state

  if (isActivityKind(kind)) {
    return { id: null, touched: false }
  }
  if (kind === 'P') {
    if (isLab(venues, state.id)) return state
    return { id: firstLab(venues) ?? state.id, touched: false }
  }
  if ((kind === 'L' || kind === 'T') && state.id == null) {
    return { id: section?.default_venue_id ?? null, touched: false }
  }
  return state
}

/** The value the dropdown and `slots.venue_id` understand: a venue id or null. */
export function venueForSave(state) {
  return state?.id ?? null
}
