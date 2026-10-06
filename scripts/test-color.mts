/**
 * Quick checks for the colour helpers behind the Soundtrack colours (no test framework).
 *
 * Run: node --no-warnings scripts/test-color.mts   (Node >= 23.6 strips types)
 */
import assert from 'node:assert/strict';

import {
    contrastRatio,
    ensureContrast,
    mixOklab,
    normalizeHexColor,
    parseHexColor,
    pickVibrantColor,
    rgbToHsl,
    toHexColor,
    type IRgb,
} from '../src/common/color.ts';
import {
    CONTEXT_COLOR_PALETTE,
    DEFAULT_CONTEXTS,
} from '../src/infra/contextEngine/common/defaults.ts';

const TEXT_ON_ACCENT = parseHexColor('#090b14')!;
const BG = parseHexColor('#0a0d16')!;

// ─── Hex ───
assert.equal(normalizeHexColor('#7C8CFF'), '#7c8cff');
assert.equal(normalizeHexColor('abc'), '#aabbcc');
assert.equal(normalizeHexColor(' #fff '), '#ffffff');
for (const bad of ['', '#12', '#12345', '#gggggg', 'red', 'rgb(1,2,3)', null, 42, undefined]) {
    assert.equal(normalizeHexColor(bad), null, String(bad));
}
assert.equal(toHexColor({ r: 300, g: -4, b: 127.6 }), '#ff0080');

// ─── Palette and defaults: all readable ───
for (const hex of CONTEXT_COLOR_PALETTE) {
    const rgb = parseHexColor(hex)!;
    assert.ok(contrastRatio(rgb, TEXT_ON_ACCENT) >= 6.5, `${hex} vs text on accent`);
    assert.ok(contrastRatio(rgb, BG) >= 4.5, `${hex} vs background`);
}
const defaultColors = DEFAULT_CONTEXTS.map((ctx) => ctx.color);
assert.equal(new Set(defaultColors).size, DEFAULT_CONTEXTS.length, 'distinct default colours');
for (const color of defaultColors) assert.ok(CONTEXT_COLOR_PALETTE.includes(color!));

// ─── ensureContrast: dark accents are lightened just enough, hue kept ───
for (const hex of ['#000000', '#1a237e', '#3b0a45', '#004d40', '#7f0000', '#333333']) {
    const rgb = parseHexColor(hex)!;
    const out = ensureContrast(rgb, TEXT_ON_ACCENT, 4.5);
    const ratio = contrastRatio(out, TEXT_ON_ACCENT);
    assert.ok(ratio >= 4.5, `${hex} → ${toHexColor(out)} ${ratio.toFixed(2)}`);
    assert.ok(ratio < 4.8, `${hex} lightened too far (${ratio.toFixed(2)})`);
    const before = rgbToHsl(rgb);
    const after = rgbToHsl(out);
    if (before.s > 0.2) assert.ok(Math.abs(before.h - after.h) < 3, `${hex} hue kept`);
}
const light = parseHexColor('#7c8cff')!;
assert.deepEqual(ensureContrast(light, TEXT_ON_ACCENT), light, 'light colour unchanged');

// ─── mixOklab: endpoints exact ───
const a = parseHexColor('#7c8cff')!;
const b = parseHexColor('#3fd0c9')!;
assert.equal(toHexColor(mixOklab(a, b, 0)), '#7c8cff');
assert.equal(toHexColor(mixOklab(a, b, 1)), '#3fd0c9');

// ─── pickVibrantColor ───
function image(fill: (i: number) => IRgb, n = 32 * 32): Uint8ClampedArray {
    const data = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
        const { r, g, b } = fill(i);
        data.set([r, g, b, 255], i * 4);
    }
    return data;
}
const hueOf = (rgb: IRgb | null) => rgbToHsl(rgb!).h;

// mostly dark grey with a red patch → red wins over the grey majority
const redPatch = pickVibrantColor(
    image((i) => (i % 5 === 0 ? { r: 220, g: 40, b: 40 } : { r: 30, g: 30, b: 34 })),
);
assert.ok(hueOf(redPatch) < 10 || hueOf(redPatch) > 350, `red patch → ${toHexColor(redPatch!)}`);

// solid blue, very dark → still blue, lightness clamped up to ≥ 0.35
const darkBlue = pickVibrantColor(image(() => ({ r: 10, g: 20, b: 90 })))!;
assert.ok(Math.abs(hueOf(darkBlue) - 232) < 8, `dark blue hue ${hueOf(darkBlue)}`);
assert.ok(rgbToHsl(darkBlue).l >= 0.449);

// greyscale → grey (no invented hue)
const grey = pickVibrantColor(
    image((i) => (i % 2 ? { r: 40, g: 40, b: 40 } : { r: 200, g: 200, b: 200 })),
)!;
assert.ok(rgbToHsl(grey).s < 0.05, 'greyscale stays grey');

// fully transparent → null
assert.equal(pickVibrantColor(new Uint8ClampedArray(16)), null);

console.log('color: all checks passed');
