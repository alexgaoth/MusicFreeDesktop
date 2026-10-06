/**
 * themeColors — runtime colour variables for themes (main window)
 *
 * Sets two custom properties on <html>; themes may read them (the Soundtrack theme does,
 * other themes ignore them):
 *   --mf-context-accent  colour of the current context, while `context.enabled` is on.
 *                        Lightened when needed, so the dark text on the accent keeps ≥ 4.5:1.
 *                        Unset when the engine is off → the theme fallback applies.
 *   --mf-art-glow        vibrant colour of the current track's artwork. No artwork, or it can
 *                        not be read → the context accent; neither → unset.
 * Changes animate over ~1.2 s (no animation with prefers-reduced-motion).
 */
import appConfig from '@infra/appConfig/renderer';
import contextEngine from '@infra/contextEngine/renderer';
import { readContextConfig, resolveContextAccent } from '@renderer/mainWindow/common/contextConfig';
import { currentMusicAtom, store } from '../trackPlayer/store';
import { getArtColor } from './artColor';
import { CssColorVar } from './cssColorVar';

class ThemeColors {
    private isSetup = false;
    private readonly accentVar = new CssColorVar('--mf-context-accent');
    private readonly glowVar = new CssColorVar('--mf-art-glow');

    private accent: string | null = null;
    /** Artwork colour of the current track (null: none or unreadable) */
    private artGlow: string | null = null;
    /** Artwork URL that `artGlow` belongs to (stale extraction results are dropped) */
    private artUrl: string | null = null;
    /** The colour of `artUrl` is still being read */
    private artPending = false;

    public setup() {
        if (this.isSetup) return;
        this.isSetup = true;

        contextEngine.onStateUpdated(() => this.updateAccent());
        appConfig.onConfigUpdated((patch) => {
            if ('context.enabled' in patch || 'context.contexts' in patch) this.updateAccent();
        });
        store.sub(currentMusicAtom, () => this.updateArtwork());

        this.updateAccent();
        this.updateArtwork();
    }

    /** Clamped accent of the current context, or null when the engine is off */
    private computeAccent(): string | null {
        const state = contextEngine.getCachedState();
        const config = readContextConfig();
        if (!config.enabled || !state?.enabled || !state.currentContextId) return null;
        const ctx = config.contexts.find((item) => item.id === state.currentContextId);
        return ctx ? resolveContextAccent(ctx) : null;
    }

    private updateAccent() {
        const accent = this.computeAccent();
        if (accent === this.accent) return;
        this.accent = accent;
        this.accentVar.set(accent);
        this.applyGlow();
    }

    private updateArtwork() {
        const url = store.get(currentMusicAtom)?.artwork || null;
        if (url === this.artUrl) return;
        this.artUrl = url;
        this.artGlow = null;
        this.artPending = !!url;
        if (!url) {
            this.applyGlow();
            return;
        }
        getArtColor(url).then((color) => {
            if (this.artUrl !== url) return;
            this.artGlow = color;
            this.artPending = false;
            this.applyGlow();
        });
    }

    private applyGlow() {
        // While the artwork colour is loading, keep the old glow (no flash to the fallback).
        if (this.artPending) return;
        this.glowVar.set(this.artGlow ?? this.accent);
    }
}

const themeColors = new ThemeColors();
export default themeColors;
