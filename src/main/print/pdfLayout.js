// pdfLayout.js — the numbers and the browser-side script behind the
// one-timetable-per-page PDF contract. Pure (no Electron), so tests can import
// everything: the fixed page box, the scale math, the footer check and the
// script that measures every sheet in the hidden window and scales it to fit.

/**
 * The printed page box. A4 landscape is 297 x 210 mm; one millimetre is left
 * at the bottom so sub-pixel rounding can never spill a second blank page.
 */
export const PAGE_BOX_MM = { width: 297, height: 209 }

/**
 * Padding inside the page box: content starts at the TOP of the sheet (6 mm),
 * 8 mm on the left and right, and 4 mm is kept free below the footer as the
 * fit safety margin so the coordinator/convener line can never be clipped.
 */
export const SHEET_PAD_MM = { top: 6, side: 8, bottom: 4 }

/** Usable content box: what `.fit` is measured and scaled into. */
export const SHEET_MM = {
  width: PAGE_BOX_MM.width - SHEET_PAD_MM.side * 2, // 281mm
  height: PAGE_BOX_MM.height - SHEET_PAD_MM.top - SHEET_PAD_MM.bottom // 199mm
}

/** The footer must end at least this far above the sheet bottom. */
export const FOOTER_MIN_MM = 2
/** Each footer re-fit step shrinks the scale by 3%... */
export const FOOTER_STEP = 0.97
/** ...and at most this many steps are tried before warning instead of clipping. */
export const FOOTER_MAX_STEPS = 10

/** Below this scale the text gets unreadable — tighten the layout first. */
export const TIGHTEN_BELOW = 0.6
/** Scales under this are reported back to the user ("this sheet shrank"). */
export const REPORT_BELOW = 0.7

/** CSS pixels per millimetre at 96 dpi — the unit getBoundingClientRect uses. */
export const MM_PER_PX = 25.4 / 96
export const mmToPx = (mm) => mm / MM_PER_PX
export const pxToMm = (px) => px * MM_PER_PX

/**
 * The per-sheet fit scale: only ever shrink, and center horizontally.
 * Pure and unit-tested; the browser script uses the same steps.
 */
export function sheetScale(sheetWidth, sheetHeight, contentWidth, contentHeight) {
  const width = Math.max(contentWidth, 1)
  const height = Math.max(contentHeight, 1)
  return Math.min(1, sheetWidth / width, sheetHeight / height)
}

/** Centering offset for a scaled block inside its sheet. */
export function centerOffset(sheetWidth, contentWidth, scale) {
  return Math.max(0, (sheetWidth - Math.max(contentWidth, 1) * scale) / 2)
}

/** Free space between the sheet's bottom edge and the footer's bottom edge. */
export function footerClearance(sheetBottom, footerBottom) {
  return sheetBottom - footerBottom
}

/** Does the measured footer leave the required 2 mm underneath it? */
export function footerFits(clearance, minimum = mmToPx(FOOTER_MIN_MM)) {
  return clearance >= minimum
}

/**
 * Round-4 Issue 3: the footer is inside the scaled block, so after a scale the
 * footer can still sit outside the sheet. This is the shrink loop, pure so it
 * can be tested with a fake measuring function instead of a real browser.
 *
 * @param {number} initialScale result of sheetScale()
 * @param {(scale: number) => number} measureGap returns the footer clearance in
 *   px for a given scale (the caller re-lays out and re-measures)
 * @returns {{ scale: number, clearance: number, steps: number, fits: boolean }}
 */
export function fitScaleWithFooter(
  initialScale,
  measureGap,
  {
    minimum = mmToPx(FOOTER_MIN_MM),
    step = FOOTER_STEP,
    maxSteps = FOOTER_MAX_STEPS
  } = {}
) {
  let scale = initialScale
  let clearance = measureGap(scale)
  let steps = 0
  while (!footerFits(clearance, minimum) && steps < maxSteps) {
    scale *= step
    steps += 1
    clearance = measureGap(scale)
  }
  return { scale, clearance, steps, fits: footerFits(clearance, minimum) }
}

/** Round a number for safe interpolation into the browser script. */
const num = (value) => Number(value.toFixed(6))

/**
 * Runs in the hidden BrowserWindow via executeJavaScript: measures every
 * `.sheet`'s `.fit` block at its natural size, applies per-sheet `transform:
 * scale()` with a top-left origin, pins it to the top of the sheet, centres it
 * horizontally only when the scale made it narrower, then re-measures the
 * footer and shrinks in 3% steps until the coordinator/convener line clears
 * the sheet bottom. Idempotent — safe to run again after `body.tight` changes
 * the CSS.
 *
 * Resolves with { scales, titles, footerGaps, warnings }:
 *   footerGaps — px between the footer bottom and the sheet bottom, per sheet
 *   warnings   — human-readable notes for sheets that still do not fit
 */
export function measureScript() {
  return `(() => new Promise((resolve) => {
  const TOP = ${num(mmToPx(SHEET_PAD_MM.top))};
  const SIDE = ${num(mmToPx(SHEET_PAD_MM.side))};
  const SAFETY = ${num(mmToPx(SHEET_PAD_MM.bottom))};
  const FOOTER_MIN = ${num(mmToPx(FOOTER_MIN_MM))};
  const STEP = ${FOOTER_STEP};
  const MAX_STEPS = ${FOOTER_MAX_STEPS};
  const sheets = Array.from(document.querySelectorAll('.sheet'));
  let settled = false;

  const run = () => {
    if (settled) return;
    settled = true;
    const result = { scales: [], titles: [], footerGaps: [], warnings: [] };

    sheets.forEach((sheet, index) => {
      const title = sheet.dataset.title || ('sheet ' + (index + 1));
      result.titles.push(title);
      const fit = sheet.querySelector('.fit');
      if (!fit) {
        result.scales.push(1);
        result.footerGaps.push(SAFETY);
        return;
      }

      // Natural size first: the previous run's transform must not affect it.
      fit.style.transform = 'none';
      fit.style.transformOrigin = 'top left';
      fit.style.top = TOP + 'px';
      fit.style.left = SIDE + 'px';

      const availW = Math.max(1, sheet.clientWidth - SIDE * 2);
      const availH = Math.max(1, sheet.clientHeight - TOP - SAFETY);
      const rect = fit.getBoundingClientRect();
      const cw = Math.max(fit.scrollWidth, rect.width, 1);
      const ch = Math.max(fit.scrollHeight, rect.height, 1);

      let s = Math.min(1, availW / cw, availH / ch);
      const apply = () => {
        fit.style.transform = 'scale(' + s + ')';
        fit.style.transformOrigin = 'top left';
        fit.style.left = (SIDE + Math.max(0, (availW - cw * s) / 2)) + 'px';
        fit.style.top = TOP + 'px';
      };
      apply();

      // The footer is the last thing in .fit: after scaling, it must still be
      // inside the sheet with the safety margin below it.
      const footer = fit.querySelector('.sign');
      let gap = SAFETY;
      if (footer) {
        const gapNow = () =>
          sheet.getBoundingClientRect().bottom - footer.getBoundingClientRect().bottom;
        gap = gapNow();
        let steps = 0;
        while (gap < FOOTER_MIN && steps < MAX_STEPS) {
          s *= STEP;
          steps += 1;
          apply();
          gap = gapNow();
        }
        if (gap < FOOTER_MIN) {
          result.warnings.push(title + ': footer does not fit (' + Math.round(gap) + 'px left)');
        }
      }

      result.scales.push(s);
      result.footerGaps.push(gap);
    });

    resolve(result);
  };

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(run, run);
    // Safety net: never block the export on a stalled font promise.
    setTimeout(run, 3000);
  } else {
    run();
  }
}))()`
}

/**
 * Once-only retry: impose stricter (smaller) scales and re-centre.
 * @param {number[]} scales per-sheet factors
 */
export function applyScalesScript(scales) {
  return `(() => {
  const list = ${JSON.stringify(scales)};
  const SIDE = ${num(mmToPx(SHEET_PAD_MM.side))};
  document.querySelectorAll('.sheet').forEach((sheet, index) => {
    const fit = sheet.querySelector('.fit');
    if (!fit) return;
    const s = list[index];
    const availW = Math.max(1, sheet.clientWidth - SIDE * 2);
    fit.style.transform = 'scale(' + s + ')';
    fit.style.transformOrigin = 'top left';
    fit.style.left = (SIDE + Math.max(0, (availW - fit.scrollWidth * s) / 2)) + 'px';
  });
})()`
}
