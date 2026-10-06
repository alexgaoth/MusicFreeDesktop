/**
 * CssColorVar — one colour custom property on <html>, with a smooth change.
 *
 * Why JS and not `@property` + CSS transition: a registered property always has a value
 * (its initial value), so the theme's `var(--x, fallback)` fallback would never apply.
 * The variables must stay unset when there is no colour.
 *
 * The colour is interpolated in OKLab over `durationMs`, once per change. Each frame writes
 * the variable only when the rounded hex value changes. Instant change when
 * `prefers-reduced-motion: reduce` is set, or when the page is hidden (no frames run then).
 */
import { mixOklab, parseHexColor, toHexColor, type IRgb } from '@common/color';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** ease-in-out (cubic) */
function ease(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export class CssColorVar {
    /** Colour shown now (mid-animation: the current frame), null = variable unset */
    private shown: IRgb | null = null;
    /** Target of the last set() call, '#rrggbb' or null */
    private target: string | null = null;
    private frame = 0;

    constructor(
        private readonly name: string,
        private readonly durationMs = 1200,
    ) {}

    /**
     * Set the colour ('#rrggbb'), or null to remove the variable (the theme fallback applies).
     * From an unset variable the colour is applied at once (there is no start colour).
     */
    public set(hex: string | null) {
        const to = hex ? parseHexColor(hex) : null;
        const key = to ? toHexColor(to) : null;
        if (key === this.target) return;
        this.target = key;
        cancelAnimationFrame(this.frame);

        const from = this.shown;
        if (!to || !from || reducedMotion.matches || document.hidden) {
            this.write(to);
            return;
        }

        const start = performance.now();
        const step = (now: number) => {
            const t = Math.min(1, (now - start) / this.durationMs);
            this.write(t >= 1 ? to : mixOklab(from, to, ease(t)));
            if (t < 1) this.frame = requestAnimationFrame(step);
        };
        this.frame = requestAnimationFrame(step);
    }

    private write(rgb: IRgb | null) {
        const style = document.documentElement.style;
        if (!rgb) {
            this.shown = null;
            style.removeProperty(this.name);
            return;
        }
        const prev = this.shown ? toHexColor(this.shown) : null;
        this.shown = rgb;
        const hex = toHexColor(rgb);
        if (hex !== prev) style.setProperty(this.name, hex);
    }
}
