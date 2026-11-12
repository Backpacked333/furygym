#!/usr/bin/env python3
"""Draws the placeholder app icon (a red F on near-black). Replace AppIcon.png with Fury Co.'s
real 1024x1024 artwork before submitting to the App Store; it must have no transparency."""
from pathlib import Path
from PIL import Image, ImageDraw

SIZE = 1024
BACKGROUND = (11, 11, 13)
RED = (229, 72, 77)

image = Image.new("RGB", (SIZE, SIZE), BACKGROUND)
draw = ImageDraw.Draw(image)

# A slanted block "F": a stem and two bars, sheared to the right for a sense of motion.
def sheared(points, shear=0.18):
    return [(x + (SIZE - y) * shear - 90, y) for x, y in points]

stem = [(300, 230), (450, 230), (450, 800), (300, 800)]
top = [(300, 230), (760, 230), (760, 370), (300, 370)]
middle = [(300, 460), (670, 460), (670, 590), (300, 590)]
for shape in (stem, top, middle):
    draw.polygon(sheared(shape), fill=RED)

out = Path(__file__).resolve().parent.parent / "FuryCo/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
image.save(out, format="PNG")
print(f"wrote {out}")
