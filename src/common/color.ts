/**
 * color — small sRGB colour helpers (pure, no DOM).
 *
 * Used by the Soundtrack colours (context accent, album-art glow) and the context colour
 * picker. Plain node scripts import this file, so keep it free of path aliases.
 */

export interface IRgb {
    /** 0–255 */
    r: number;
    g: number;
    b: number;
}

interface IOklab {
    l: number;
    a: number;
    b: number;
}

// ─── Hex ───

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse '#rgb' / '#rrggbb' (the '#' is optional). Returns null for anything else. */
export function parseHexColor(value: unknown): IRgb | null {
    if (typeof value !== 'string') return null;
    const match = HEX_RE.exec(value.trim());
    if (!match) return null;
    let hex = match[1];
    if (hex.length === 3) {
        hex = hex
            .split('')
            .map((ch) => ch + ch)
            .join('');
    }
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff };
}

/** '#rrggbb' (lowercase) */
export function toHexColor({ r, g, b }: IRgb): string {
    const part = (v: number) =>
        Math.round(Math.min(255, Math.max(0, v)))
            .toString(16)
            .padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
}

/** Canonical '#rrggbb' form of a hex colour, or null when the value is not a hex colour */
export function normalizeHexColor(value: unknown): string | null {
    const rgb = parseHexColor(value);
    return rgb ? toHexColor(rgb) : null;
}

// ─── Contrast (WCAG 2) ───

function channelToLinear(v: number): number {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(v: number): number {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, c * 255));
}

export function relativeLuminance({ r, g, b }: IRgb): number {
    return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(a: IRgb, b: IRgb): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Straight sRGB mix: t = 0 → a, t = 1 → b */
export function mixRgb(a: IRgb, b: IRgb, t: number): IRgb {
    return {
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
    };
}

const WHITE: IRgb = { r: 255, g: 255, b: 255 };
const BLACK: IRgb = { r: 0, g: 0, b: 0 };

/**
 * Return `color`, lightened (dark `against`) or darkened (light `against`) by the smallest
 * amount that gives at least `minRatio` contrast with `against`. Keeps the hue.
 */
export function ensureContrast(color: IRgb, against: IRgb, minRatio = 4.5): IRgb {
    if (contrastRatio(color, against) >= minRatio) return color;
    const target = relativeLuminance(against) < 0.18 ? WHITE : BLACK;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (contrastRatio(mixRgb(color, target, mid), against) >= minRatio) hi = mid;
        else lo = mid;
    }
    // Round to whole channels; rounding can lose the last 0.01 of contrast, so step on.
    const at = (t: number): IRgb => {
        const out = mixRgb(color, target, t);
        return { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b) };
    };
    let out = at(hi);
    while (contrastRatio(out, against) < minRatio && hi < 1) {
        hi = Math.min(1, hi + 1 / 255);
        out = at(hi);
    }
    return out;
}

// ─── OKLab (perceptual interpolation) ───

function rgbToOklab({ r, g, b }: IRgb): IOklab {
    const lr = channelToLinear(r);
    const lg = channelToLinear(g);
    const lb = channelToLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
        l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    };
}

function oklabToRgb({ l, a, b }: IOklab): IRgb {
    const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return {
        r: linearToChannel(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
        g: linearToChannel(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
        b: linearToChannel(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    };
}

/** Perceptual mix (OKLab): t = 0 → a, t = 1 → b. Avoids the grey middle of an sRGB mix. */
export function mixOklab(a: IRgb, b: IRgb, t: number): IRgb {
    const la = rgbToOklab(a);
    const lb = rgbToOklab(b);
    return oklabToRgb({
        l: la.l + (lb.l - la.l) * t,
        a: la.a + (lb.a - la.a) * t,
        b: la.b + (lb.b - la.b) * t,
    });
}

// ─── HSL ───

/** h: 0–360, s: 0–1, l: 0–1 */
export function rgbToHsl({ r, g, b }: IRgb): { h: number; s: number; l: number } {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): IRgb {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let rgb: [number, number, number];
    if (hp < 1) rgb = [c, x, 0];
    else if (hp < 2) rgb = [x, c, 0];
    else if (hp < 3) rgb = [0, c, x];
    else if (hp < 4) rgb = [0, x, c];
    else if (hp < 5) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    const m = l - c / 2;
    return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
}

// ─── Dominant colour ───

const HUE_BINS = 12;

/**
 * Pick a vibrant, mid-luminance colour from RGBA pixel data (e.g. a 32×32 canvas).
 *
 * Pixels are grouped by hue (12 bins). Each pixel scores by saturation, and less when it is
 * very dark or very light. The best bin's weighted average wins. Images without colour
 * (greyscale) give their average grey. The result is clamped to lightness 0.45–0.65 so it
 * shows as a glow on a dark background. Returns null when no pixel is opaque.
 */
export function pickVibrantColor(data: ArrayLike<number>): IRgb | null {
    const bins = Array.from({ length: HUE_BINS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let greyW = 0;
    const grey = { r: 0, g: 0, b: 0 };

    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const px = { r: data[i], g: data[i + 1], b: data[i + 2] };
        greyW++;
        grey.r += px.r;
        grey.g += px.g;
        grey.b += px.b;

        const { h, s, l } = rgbToHsl(px);
        if (s < 0.2 || l < 0.08 || l > 0.92) continue;
        // 1 at l = 0.5, 0 at the ends
        const midness = 1 - Math.abs(l - 0.5) * 2;
        const w = s * s * (0.35 + 0.65 * midness);
        const bin = bins[Math.floor(h / (360 / HUE_BINS)) % HUE_BINS];
        bin.w += w;
        bin.r += px.r * w;
        bin.g += px.g * w;
        bin.b += px.b * w;
    }
    if (!greyW) return null;

    // A hue that covers a few stray pixels is noise: require ~3 % of the weight of the image.
    const best = bins.reduce((acc, bin) => (bin.w > acc.w ? bin : acc));
    const picked =
        best.w > greyW * 0.03
            ? { r: best.r / best.w, g: best.g / best.w, b: best.b / best.w }
            : { r: grey.r / greyW, g: grey.g / greyW, b: grey.b / greyW };

    const hsl = rgbToHsl(picked);
    const out = hslToRgb(hsl.h, hsl.s, Math.min(0.65, Math.max(0.45, hsl.l)));
    return { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b) };
}
