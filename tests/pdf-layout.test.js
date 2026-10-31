import { describe, expect, it } from 'vitest'
import {
  FOOTER_MIN_MM,
  FOOTER_STEP,
  PAGE_BOX_MM,
  SHEET_MM,
  SHEET_PAD_MM,
  TIGHTEN_BELOW,
  centerOffset,
  footerClearance,
  footerFits,
  fitScaleWithFooter,
  applyScalesScript,
  mmToPx,
  measureScript,
  pxToMm,
  sheetScale
} from '../src/main/print/pdfLayout.js'

describe('the fixed page box (round-4 Issue 3)', () => {
  it('is A4 landscape minus a little slack so no blank page is ever pushed', () => {
    expect(PAGE_BOX_MM.width).toBe(297)
    expect(PAGE_BOX_MM.height).toBeLessThan(210)
    expect(PAGE_BOX_MM.height).toBeGreaterThan(205)
  })

  it('leaves 6 mm at the top and 8 mm at the sides, never vertical centring', () => {
    expect(SHEET_PAD_MM).toEqual({ top: 6, side: 8, bottom: 4 })
    expect(SHEET_MM.width).toBe(PAGE_BOX_MM.width - 16)
    expect(SHEET_MM.height).toBe(PAGE_BOX_MM.height - SHEET_PAD_MM.top - SHEET_PAD_MM.bottom)
  })

  it('reserves the footer safety margin inside the usable height', () => {
    // The 4 mm safety margin is already taken out of the fit height...
    expect(SHEET_MM.height).toBe(PAGE_BOX_MM.height - 10)
    // ...and the footer itself must end 2 mm above the sheet bottom.
    expect(FOOTER_MIN_MM).toBeGreaterThan(0)
    expect(FOOTER_MIN_MM).toBeLessThan(SHEET_PAD_MM.bottom)
  })

  it('converts millimetres to CSS pixels at 96 dpi', () => {
    expect(mmToPx(25.4)).toBeCloseTo(96)
    expect(pxToMm(96)).toBeCloseTo(25.4)
  })
})

describe('sheetScale — per-sheet fit factor', () => {
  it('never scales up: fitting content inside a bigger sheet stays at 1', () => {
    expect(sheetScale(SHEET_MM.width, SHEET_MM.height, 100, 50)).toBe(1)
    expect(sheetScale(SHEET_MM.width, SHEET_MM.height, 50, 100)).toBe(1)
  })

  it('shrinks to the tighter of width or height', () => {
    // Width needs 281/562 ~= 0.5, height needs 199/200 ~= 0.995 -> width wins.
    expect(sheetScale(SHEET_MM.width, SHEET_MM.height, 562, 200)).toBeCloseTo(281 / 562)
    // Height is the binding constraint here.
    expect(sheetScale(SHEET_MM.width, SHEET_MM.height, 300, 388)).toBeCloseTo(SHEET_MM.height / 388)
  })

  it('evenly applies to the cramped stress direction (tall 3-lane days)', () => {
    // A legend-heavy sheet ~40% too tall gets scaled to ~0.714...
    const scale = sheetScale(SHEET_MM.width, SHEET_MM.height, SHEET_MM.width, SHEET_MM.height / 0.714)
    expect(scale).toBeCloseTo(0.714, 2)
  })

  it('guards against zero-sized content', () => {
    expect(sheetScale(SHEET_MM.width, SHEET_MM.height, 0, 0)).toBe(1)
  })

  it('keeps the tighten threshold below the report threshold', () => {
    expect(TIGHTEN_BELOW).toBeLessThan(0.7)
  })
})

describe('centerOffset', () => {
  it('centers a narrower scaled block', () => {
    // 200 wide content scaled to 0.5 = 100 wide, sheet 281 -> offset 90.5
    expect(centerOffset(SHEET_MM.width, 200, 0.5)).toBeCloseTo(90.5)
  })

  it('returns 0 when the block fills the sheet', () => {
    expect(centerOffset(SHEET_MM.width, SHEET_MM.width, 1)).toBe(0)
  })
})

describe('footer clearance — the coordinator/convener line is never clipped', () => {
  it('measures the gap between the sheet bottom and the footer bottom', () => {
    expect(footerClearance(800, 770)).toBe(30)
    expect(footerClearance(800, 0)).toBe(800)
  })

  it('accepts only a gap of at least the 2 mm minimum', () => {
    expect(footerFits(mmToPx(4))).toBe(true)
    expect(footerFits(mmToPx(2))).toBe(true)
    expect(footerFits(mmToPx(1))).toBe(false)
    expect(footerFits(-3)).toBe(false)
  })

  it('does not touch a scale that already clears the footer', () => {
    const calls = []
    const result = fitScaleWithFooter(0.92, (scale) => {
      calls.push(scale)
      return mmToPx(6)
    })
    expect(result.scale).toBe(0.92)
    expect(result.steps).toBe(0)
    expect(result.fits).toBe(true)
    expect(calls).toEqual([0.92])
  })

  it('shrinks in 3% steps until the footer fits', () => {
    // A gap of 0 at scale 1 that grows 1 mm per 3% shrink: needs ~2 steps.
    const result = fitScaleWithFooter(1, (scale) => (1 - scale) * mmToPx(100))
    expect(result.steps).toBe(1)
    expect(result.scale).toBeCloseTo(FOOTER_STEP, 6)
    expect(result.fits).toBe(true)
    expect(result.clearance).toBeGreaterThanOrEqual(mmToPx(FOOTER_MIN_MM))
  })

  it('gives up after 10 steps and reports that it did not fit', () => {
    let calls = 0
    const result = fitScaleWithFooter(1, () => {
      calls += 1
      return 0 // never enough room
    })
    expect(result.fits).toBe(false)
    expect(result.steps).toBe(10)
    expect(calls).toBe(11) // one initial measurement + ten shrinks
    expect(result.scale).toBeCloseTo(FOOTER_STEP ** 10, 6)
  })

  it('can never grow the scale it was given', () => {
    const result = fitScaleWithFooter(0.8, () => mmToPx(10))
    expect(result.scale).toBe(0.8)
  })
})

describe('measureScript', () => {
  const script = measureScript()

  it('pins every sheet to the top of its box with the pad values', () => {
    expect(script).toContain(`const TOP = ${Number(mmToPx(6).toFixed(6))};`)
    expect(script).toContain(`const SIDE = ${Number(mmToPx(8).toFixed(6))};`)
    expect(script).toContain(`const SAFETY = ${Number(mmToPx(4).toFixed(6))};`)
    // No vertical centring anywhere: only a horizontal left offset is set.
    expect(script).not.toContain('translateY')
    expect(script).toContain("fit.style.top = TOP + 'px'")
  })

  it('measures at natural size, after fonts are ready', () => {
    expect(script).toContain('document.fonts.ready')
    expect(script).toContain("fit.style.transform = 'none'")
    expect(script).toContain('sheet.querySelector')
  })

  it('re-measures the footer and shrinks in 3% steps, at most ten times', () => {
    expect(script).toContain("fit.querySelector('.sign')")
    expect(script).toContain('getBoundingClientRect().bottom')
    expect(script).toContain(`const STEP = ${FOOTER_STEP};`)
    expect(script).toContain('const MAX_STEPS = 10;')
    expect(script).toContain('result.warnings.push')
  })

  it('reports the footer gap and titles for every sheet', () => {
    expect(script).toContain('footerGaps')
    expect(script).toContain('titles')
    expect(script).toContain('dataset.title')
  })
})

describe('applyScalesScript', () => {
  it('applies one scale per sheet in document order', () => {
    const script = applyScalesScript([1, 0.85])
    expect(script).toContain('1,0.85')
    expect(script).toContain('.sheet')
    expect(script).toContain('scale(')
  })

  it('keeps the horizontal inset when it re-centres', () => {
    const script = applyScalesScript([0.9])
    expect(script).toContain('fit.style.left')
    expect(script).not.toContain('marginLeft')
  })
})
