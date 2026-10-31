import { describe, expect, it } from 'vitest'
import {
  initialVenueState,
  venueAfterKindChange,
  venueForSave
} from '../src/renderer/src/lib/venueState'

// Round-3 Issues 1 and 4. The old editor collapsed three states into one
// `venue ?? defaultVenue` value, so a new Activity opened with the section's
// default venue, choosing None fell back to the default after saving, and
// switching kind never reset anything. These tests pin the explicit rules.
const section = { default_venue_id: 7 }
const venues = [
  { id: 3, kind: 'lab', code: 'Lab-1' },
  { id: 7, kind: 'classroom', code: 'B-321' },
  { id: 9, kind: 'classroom', code: 'B-109' }
]

describe('initialVenueState', () => {
  it('Issue 1: a NEW activity starts at None, not the section default', () => {
    expect(initialVenueState(null, section, venues, 'ACTIVITY')).toEqual({
      id: null,
      touched: false
    })
  })

  it('Issue 4: an EXISTING activity stored with no venue shows None on reopen', () => {
    const state = initialVenueState({ venue_id: null, kind: 'ACTIVITY' }, section, venues, 'ACTIVITY')
    expect(state).toEqual({ id: null, touched: true })
    // ...and that None must not silently become the default again.
    expect(venueForSave(state)).toBeNull()
  })

  it('an existing activity with a venue keeps that venue', () => {
    expect(initialVenueState({ venue_id: 9, kind: 'ACTIVITY' }, section, venues, 'ACTIVITY')).toEqual({
      id: 9,
      touched: true
    })
  })

  it('a fresh class still starts at the section default venue', () => {
    expect(initialVenueState(null, section, venues, 'L')).toEqual({ id: 7, touched: false })
  })

  it('pasting an activity keeps its venue exactly, including none', () => {
    expect(initialVenueState({ venue_id: null, kind: 'ACTIVITY', label: 'Sports' }, section, venues, 'ACTIVITY').id).toBeNull()
    expect(initialVenueState({ venue_id: 3, kind: 'ACTIVITY', label: 'Sports' }, section, venues, 'ACTIVITY').id).toBe(3)
  })
})

describe('venueAfterKindChange', () => {
  it('from a class editor: switching to Activity resets None when untouched', () => {
    const untouched = { id: 7, touched: false }
    expect(venueAfterKindChange(untouched, 'ACTIVITY', section, venues)).toEqual({
      id: null,
      touched: false
    })
  })

  it('Issue 4: a manually chosen venue survives the switch to Activity', () => {
    const touched = { id: 9, touched: true }
    expect(venueAfterKindChange(touched, 'ACTIVITY', section, venues)).toEqual(touched)
  })

  it('Issue 1: switching back to a class fills the default venue when untouched', () => {
    const untouchedActivity = { id: null, touched: false }
    expect(venueAfterKindChange(untouchedActivity, 'L', section, venues)).toEqual({
      id: 7,
      touched: false
    })
  })

  it('switching a touched venue between L/T/P keeps the choice', () => {
    const touched = { id: 9, touched: true }
    expect(venueAfterKindChange(touched, 'P', section, venues)).toEqual(touched)
  })

  it('untouched practical with a non-lab venue moves to the first lab', () => {
    const untouchedClass = { id: 7, touched: false }
    expect(venueAfterKindChange(untouchedClass, 'P', section, venues)).toEqual({
      id: 3,
      touched: false
    })
  })
})
