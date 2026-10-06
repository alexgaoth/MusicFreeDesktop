/**
 * artColor — vibrant colour of an artwork image, cached per URL.
 *
 * The image is drawn to a 32×32 offscreen canvas and read back (see pickVibrantColor).
 * Remote artwork: loaded with `crossOrigin = 'anonymous'` first; when that load fails (no CORS
 * headers on a server that checks), retry without it. A tainted canvas makes getImageData
 * throw → null. Load errors and timeouts → null. Null results are cached too (no retry loop).
 */
import { pickVibrantColor, toHexColor } from '@common/color';

const SAMPLE_SIZE = 32;
const LOAD_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 64;

/** url → '#rrggbb' | null. Insertion order = age (oldest first). */
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

function loadImage(url: string, cors: boolean): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        if (cors) img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        const timer = window.setTimeout(() => {
            img.src = '';
            reject(new Error('artwork load timeout'));
        }, LOAD_TIMEOUT_MS);
        img.onload = () => {
            window.clearTimeout(timer);
            resolve(img);
        };
        img.onerror = () => {
            window.clearTimeout(timer);
            reject(new Error('artwork load failed'));
        };
        img.src = url;
    });
}

function sample(img: HTMLImageElement): string | null {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    // Throws a SecurityError when the canvas is tainted (cross-origin image without CORS).
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const rgb = pickVibrantColor(data);
    return rgb ? toHexColor(rgb) : null;
}

async function extract(url: string): Promise<string | null> {
    const isRemote = /^https?:/i.test(url);
    let img: HTMLImageElement;
    try {
        img = await loadImage(url, isRemote);
    } catch {
        if (!isRemote) return null;
        try {
            img = await loadImage(url, false);
        } catch {
            return null;
        }
    }
    try {
        return sample(img);
    } catch {
        return null;
    }
}

function remember(url: string, color: string | null) {
    cache.delete(url);
    cache.set(url, color);
    if (cache.size > CACHE_LIMIT) {
        cache.delete(cache.keys().next().value as string);
    }
}

/** Vibrant colour ('#rrggbb') of the artwork at `url`, or null when it can not be read */
export function getArtColor(url: string): Promise<string | null> {
    if (cache.has(url)) {
        const color = cache.get(url) ?? null;
        remember(url, color); // refresh age
        return Promise.resolve(color);
    }
    let job = inflight.get(url);
    if (!job) {
        job = extract(url).then((color) => {
            inflight.delete(url);
            remember(url, color);
            return color;
        });
        inflight.set(url, job);
    }
    return job;
}
