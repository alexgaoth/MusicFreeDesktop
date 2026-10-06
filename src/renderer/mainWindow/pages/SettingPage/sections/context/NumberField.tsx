import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@renderer/mainWindow/components/ui/Input';

interface NumberFieldProps {
    value: number;
    /** Called on blur / Enter with the clamped, rounded value (only when it changed) */
    onCommit: (value: number) => void;
    min: number;
    max: number;
    /** Unit shown after the value, e.g. 's' */
    unit?: string;
    'aria-label'?: string;
}

/**
 * NumberField — whole-number input that commits on blur or Enter.
 * Invalid input reverts to the last committed value.
 */
export function NumberField({
    value,
    onCommit,
    min,
    max,
    unit,
    'aria-label': ariaLabel,
}: NumberFieldProps) {
    const [text, setText] = useState(String(value));
    const focused = useRef(false);

    useEffect(() => {
        if (!focused.current) setText(String(value));
    }, [value]);

    const commit = useCallback(() => {
        focused.current = false;
        const parsed = Math.round(Number(text));
        if (text.trim() === '' || !Number.isFinite(parsed)) {
            setText(String(value));
            return;
        }
        const next = Math.min(max, Math.max(min, parsed));
        setText(String(next));
        if (next !== value) onCommit(next);
    }, [text, value, min, max, onCommit]);

    return (
        <Input
            className="p-setting__context-number"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            value={text}
            aria-label={ariaLabel}
            suffix={unit ? <span className="p-setting__context-unit">{unit}</span> : undefined}
            onFocus={() => {
                focused.current = true;
            }}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
        />
    );
}
