import { describe, expect, it } from 'vitest'
import { mergeOfferState } from '../src/renderer/src/lib/mergeOffers'

// Regression tests for round-3 Issue 3 item 5: when the teacher clash and the
// venue clash come from two different slots, the editor must not offer two
// (broken) merge buttons but explain that one merge cannot resolve both.
describe('mergeOfferState', () => {
  const teacherOffer = (slotId, section) => ({
    type: 'teacher',
    merge_timing_ok: true,
    merge: { slot_id: slotId, section }
  })
  const venueOffer = (slotId, section) => ({
    type: 'venue',
    merge_timing_ok: true,
    merge: { slot_id: slotId, section }
  })

  it('offers one button when every clash points at the same slot', () => {
    const { offers, blockedNote } = mergeOfferState([
      teacherOffer(11, '5-A'),
      venueOffer(11, '5-A'),
      { type: 'section', message: 'unrelated' }
    ])
    expect(offers).toHaveLength(1)
    expect(offers[0].slot_id).toBe(11)
    expect(blockedNote).toBe('')
  })

  it('before the fix: offers were rendered for both slots (no note) — now blocked', () => {
    const { offers, blockedNote } = mergeOfferState([teacherOffer(11, '5-A'), venueOffer(22, '5-C')])
    expect(offers).toEqual([])
    expect(blockedNote).toContain('5-A')
    expect(blockedNote).toContain('5-C')
    expect(blockedNote).toContain('one merge cannot resolve both')
  })

  it('keeps no button for partial-timing clashes (merge_timing_ok false)', () => {
    const { offers } = mergeOfferState([
      { type: 'teacher', merge_timing_ok: false, merge: null }
    ])
    expect(offers).toEqual([])
  })

  it('handles missing problems gracefully', () => {
    expect(mergeOfferState(null)).toEqual({ offers: [], blockedNote: '' })
    expect(mergeOfferState([])).toEqual({ offers: [], blockedNote: '' })
  })
})
