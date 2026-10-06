#!/usr/bin/env bash
# Build the macOS context signal helper (native/context-helper/main.swift).
#
# Usage: scripts/build-context-helper.sh [arm64|x64|universal]   (default: host arch)
# Output: build/native/context-helper (gitignored; never commit the binary)
#
# Skips the build when the binary is newer than the source and was built for the same arch.
# Exits 0 without building on non-macOS hosts.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "[context-helper] not macOS, skip"
    exit 0
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/native/context-helper/main.swift"
OUT_DIR="$ROOT/build/native"
OUT="$OUT_DIR/context-helper"
STAMP="$OUT_DIR/context-helper.arch"
MIN_MACOS="11.0"

ARCH="${1:-$(uname -m)}"
case "$ARCH" in
    arm64) TARGETS=(arm64) ;;
    x64 | x86_64) TARGETS=(x86_64) ;;
    universal) TARGETS=(arm64 x86_64) ;;
    *)
        echo "[context-helper] unknown arch: $ARCH" >&2
        exit 1
        ;;
esac

if [[ -x "$OUT" && "$OUT" -nt "$SRC" && -f "$STAMP" && "$(cat "$STAMP")" == "$ARCH" ]]; then
    echo "[context-helper] up to date ($ARCH)"
    exit 0
fi

mkdir -p "$OUT_DIR"
SLICES=()
for target in "${TARGETS[@]}"; do
    slice="$OUT_DIR/context-helper-$target"
    swiftc -O -target "$target-apple-macos$MIN_MACOS" "$SRC" -o "$slice"
    SLICES+=("$slice")
done

if [[ ${#SLICES[@]} -gt 1 ]]; then
    lipo -create "${SLICES[@]}" -output "$OUT"
    rm -f "${SLICES[@]}"
else
    mv "${SLICES[0]}" "$OUT"
fi

echo "$ARCH" > "$STAMP"
echo "[context-helper] built $OUT ($ARCH)"
