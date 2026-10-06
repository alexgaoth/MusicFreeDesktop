import type { LucideIcon } from 'lucide-react';
import {
    AudioWaveform,
    BookOpen,
    Brain,
    Briefcase,
    Car,
    Code,
    Coffee,
    Dumbbell,
    Film,
    Flame,
    Gamepad2,
    Headphones,
    Heart,
    Laptop,
    Leaf,
    MessageCircle,
    Moon,
    Mountain,
    Music,
    Palette,
    PenTool,
    Plane,
    Sparkles,
    Sun,
    Target,
    Train,
    Users,
    Utensils,
    Waves,
    Zap,
} from 'lucide-react';

/**
 * Icons a context can use. Keys are lucide icon ids (kebab-case), the format stored in
 * `IContextDef.icon`. A curated set keeps the bundle small (no full lucide import).
 */
export const CONTEXT_ICONS: Record<string, LucideIcon> = {
    brain: Brain,
    briefcase: Briefcase,
    'message-circle': MessageCircle,
    coffee: Coffee,
    moon: Moon,
    code: Code,
    'book-open': BookOpen,
    'pen-tool': PenTool,
    palette: Palette,
    laptop: Laptop,
    target: Target,
    zap: Zap,
    users: Users,
    headphones: Headphones,
    music: Music,
    'gamepad-2': Gamepad2,
    film: Film,
    dumbbell: Dumbbell,
    utensils: Utensils,
    sun: Sun,
    leaf: Leaf,
    mountain: Mountain,
    waves: Waves,
    flame: Flame,
    heart: Heart,
    car: Car,
    train: Train,
    plane: Plane,
    sparkles: Sparkles,
};

export const CONTEXT_ICON_NAMES = Object.keys(CONTEXT_ICONS);

interface ContextIconProps {
    /** lucide icon id or an emoji */
    name?: string;
    size?: number;
    className?: string;
}

/**
 * ContextIcon — icon of a listening context.
 *
 * Known lucide ids render the icon; any other non-empty value (for example an emoji) renders
 * as text; no value renders the generic soundtrack icon.
 */
export function ContextIcon({ name, size = 16, className }: ContextIconProps) {
    const Icon = name ? CONTEXT_ICONS[name] : AudioWaveform;
    if (Icon) {
        return <Icon size={size} className={className} aria-hidden="true" />;
    }
    return (
        <span className={className} style={{ fontSize: size, lineHeight: 1 }} aria-hidden="true">
            {name}
        </span>
    );
}

export default ContextIcon;
