#!/usr/bin/env python3
"""Generate cute peach-heart PWA icons as PNGs using only the stdlib.

Draws a soft peach->pink rounded-square background with a glossy heart in the
middle. No external libraries required. Run from the project root:

    python3 tools/make_icons.py
"""
import os
import struct
import zlib
import math

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")


def lerp(a, b, t):
    return a + (b - a) * t


def mix(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def rounded_rect_alpha(x, y, w, h, radius):
    """Return 1.0 inside a rounded rect of size w*h, 0 outside, with a 1px soft edge."""
    # distance from nearest edge, accounting for corner radius
    rx = min(max(x, radius), w - radius)
    ry = min(max(y, radius), h - radius)
    dx = x - rx
    dy = y - ry
    if dx == 0 and dy == 0:
        return 1.0
    dist = math.sqrt(dx * dx + dy * dy)
    return max(0.0, min(1.0, radius - dist + 0.5))


def heart_value(nx, ny):
    """Classic heart implicit curve. <=0 means inside. nx,ny normalized, y up."""
    return (nx * nx + ny * ny - 1) ** 3 - nx * nx * (ny ** 3)


def make_icon(size, maskable=False):
    # Warm editorial palette: paper canvas, muted terracotta heart.
    top = (250, 245, 239)      # paper
    bottom = (240, 230, 220)   # warm sand
    heart_light = (206, 108, 72)
    heart_dark = (150, 66, 44)

    # For maskable icons keep art within the safe ~80% center zone.
    pad = size * (0.16 if maskable else 0.0)
    radius = size * (0.5 if maskable else 0.235)  # maskable -> near circle; normal -> squircle

    buf = bytearray()
    cx = size / 2.0
    cy = size / 2.0
    # heart fills roughly 58% of the inner area
    inner = size - 2 * pad
    heart_scale = inner * 0.30
    heart_cy = cy - inner * 0.02

    for py in range(size):
        buf.append(0)  # PNG filter type 0 for each scanline
        for px in range(size):
            # background
            t = py / (size - 1)
            bg = mix(top, bottom, t)
            a_bg = rounded_rect_alpha(px - pad, py - pad, size - 2 * pad, size - 2 * pad, radius)

            r, g, b = bg
            a = a_bg

            # heart (normalized coords, y up)
            nx = (px - cx) / heart_scale
            ny = (heart_cy - py) / heart_scale  # invert y so heart points down
            hv = heart_value(nx, ny)
            if hv <= 0.0:
                # gentle, matte vertical shade (editorial — no glossy hotspot)
                gt = max(0.0, min(1.0, (py - (heart_cy - heart_scale * 1.3)) / (heart_scale * 2.6)))
                hr, hg, hb = mix(heart_light, heart_dark, gt)
                # whisper of a top-left highlight, barely there
                hl = max(0.0, 1.0 - (((nx + 0.45) ** 2 + (ny - 0.55) ** 2) * 1.9))
                hr = int(min(255, hr + hl * 22))
                hg = int(min(255, hg + hl * 18))
                hb = int(min(255, hb + hl * 16))
                # antialias heart edge using the implicit value magnitude
                edge = max(0.0, min(1.0, -hv * 6.0 + 0.5))
                r = int(lerp(r, hr, edge))
                g = int(lerp(g, hg, edge))
                b = int(lerp(b, hb, edge))

            buf.append(max(0, min(255, r)))
            buf.append(max(0, min(255, g)))
            buf.append(max(0, min(255, b)))
            buf.append(max(0, min(255, int(round(a * 255)))))

    return png_bytes(size, size, bytes(buf))


def png_chunk(tag, data):
    chunk = struct.pack(">I", len(data)) + tag + data
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return chunk + struct.pack(">I", crc)


def png_bytes(width, height, raw):
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw, 9)
    return sig + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", idat) + png_chunk(b"IEND", b"")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
        ("favicon-64.png", 64, False),
    ]
    for name, size, maskable in targets:
        data = make_icon(size, maskable)
        path = os.path.join(OUT_DIR, name)
        with open(path, "wb") as f:
            f.write(data)
        print(f"wrote {path} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
