"""
Build the AMIVARA Android font assets (AMIVARA_ROSE.md §3.1).

Downloads the Playfair and Inter variable fonts from a pinned google/fonts
commit, verifies their SHA-256, creates static instances for the weights the
type scale uses, subsets them to Latin + Latin Extended + the Yoruba, Igbo and
Hausa characters + ₦, verifies coverage, and writes them (with the OFL
licences) to apps/mobile/assets/fonts/.

Static instances, not variable fonts: Flutter does not reliably map
FontWeight onto a variable font's wght axis, and fixed weights keep Android
rendering identical to the design tokens.

Usage (from the repo root):
    python -m venv .venv-fonts
    .venv-fonts/bin/pip install -r scripts/fonts/requirements.txt   (Windows: .venv-fonts\\Scripts\\pip)
    .venv-fonts/bin/python -I scripts/fonts/build_fonts.py

The output is deterministic: re-running produces byte-identical files.
"""

from __future__ import annotations

import hashlib
import io
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "apps" / "mobile" / "assets" / "fonts"

GOOGLE_FONTS = "https://raw.githubusercontent.com/google/fonts"


@dataclass(frozen=True)
class Source:
    family: str
    commit: str
    path: str
    sha256: str
    license_path: str
    license_sha256: str


SOURCES = {
    "Playfair": Source(
        family="Playfair",
        commit="8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5",
        path="ofl/playfair/Playfair%5Bopsz%2Cwdth%2Cwght%5D.ttf",
        sha256="33cfecbc9948cf9eafe54dc9f36d19a03b393cf12221b20be235926d1ca1db61",
        license_path="ofl/playfair/OFL.txt",
        license_sha256="7d16bbb17375beefaa4d1d25c41f860cb161c9e614b44af790983a9fd7102627",
    ),
    "Inter": Source(
        family="Inter",
        commit="0b58fb370093f9a9f4ff785d94405710b79de67c",
        path="ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
        sha256="29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
        license_path="ofl/inter/OFL.txt",
        license_sha256="5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57",
    ),
}

# Optical size and width are pinned for static instances.
#  - Playfair opsz 24: hairlines (including the ₦ crossbars) stay visible on
#    low-density screens; opsz 48+ thins them out at headline sizes.
#  - Playfair wdth 100: closest to the approved Playfair Display proportions
#    (the font's default 112.5 is SemiExpanded).
#  - Inter opsz 14: text optical size; the type scale uses Inter only at 12–22sp.
INSTANCES = [
    ("Playfair", "SemiBold", 600, {"opsz": 24, "wdth": 100, "wght": 600}),
    ("Playfair", "Bold", 700, {"opsz": 24, "wdth": 100, "wght": 700}),
    ("Inter", "Regular", 400, {"opsz": 14, "wght": 400}),
    ("Inter", "Medium", 500, {"opsz": 14, "wght": 500}),
    ("Inter", "SemiBold", 600, {"opsz": 14, "wght": 600}),
]

# Character set: Latin, Latin-1, Latin Extended-A/B, IPA (Hausa ɓ ɗ), spacing
# modifiers (Hausa ʼ), combining marks (Yoruba/Igbo tone marks and dot below),
# Latin Extended Additional (ẹ ọ ṣ ị ụ ṅ), punctuation, currency (₦),
# letterlike symbols, arrows, minus, and the dotted circle HarfBuzz uses for
# lone combining marks.
UNICODE_RANGES = [
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x0100, 0x017F),
    (0x0180, 0x024F),
    (0x0250, 0x02AF),
    (0x02B0, 0x02FF),
    (0x0300, 0x036F),
    (0x1E00, 0x1EFF),
    (0x2000, 0x206F),
    (0x20A0, 0x20CF),
    (0x2100, 0x214F),
    (0x2190, 0x2199),
    (0x2212, 0x2212),
    (0x25CC, 0x25CC),
]

# Must be present in every output font, or the build fails.
REQUIRED = {
    "Yoruba": "ẸẹỌọṢṣŃńǸǹÀàÁáÈèÉéÌìÍíÒòÓóÙùÚú",
    "Igbo": "ỊịỤụṄṅ",
    "Hausa": "ƁɓƊɗƘƙƳƴʼ",
    "Combining marks": "̣̀́̄",
    "Naira": "₦",
}


def download(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "amivara-font-build"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def verify(data: bytes, expected: str, what: str) -> None:
    actual = hashlib.sha256(data).hexdigest()
    if actual != expected:
        sys.exit(f"SHA-256 mismatch for {what}: expected {expected}, got {actual}")


def build_instance(variable: bytes, family: str, style: str, weight: int, axes: dict) -> TTFont:
    font = TTFont(io.BytesIO(variable), recalcTimestamp=False)
    font = instancer.instantiateVariableFont(font, axes)

    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.hinting = False
    options.notdef_outline = True
    options.glyph_names = False
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=[cp for lo, hi in UNICODE_RANGES for cp in range(lo, hi + 1)])
    subsetter.subset(font)

    font["OS/2"].usWeightClass = weight
    name = font["name"]
    full = f"{family} {style}"
    postscript = f"{family}-{style}"
    for record in list(name.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17, 25):
            name.removeNames(nameID=record.nameID)
    name.setName(family, 1, 3, 1, 0x409)
    name.setName("Regular" if style == "Regular" else style, 2, 3, 1, 0x409)
    name.setName(f"{postscript};AMIVARA subset", 3, 3, 1, 0x409)
    name.setName(full, 4, 3, 1, 0x409)
    name.setName(postscript, 6, 3, 1, 0x409)
    return font


def check_coverage(font: TTFont, label: str) -> None:
    cmap = font.getBestCmap()
    missing = {
        group: " ".join(f"U+{ord(c):04X}" for c in chars if ord(c) not in cmap)
        for group, chars in REQUIRED.items()
    }
    missing = {k: v for k, v in missing.items() if v}
    if missing:
        sys.exit(f"{label} is missing required characters: {missing}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # Sources are only held in memory; nothing downloaded is executed or kept.
    variables: dict[str, bytes] = {}
    for key, src in SOURCES.items():
        base = f"{GOOGLE_FONTS}/{src.commit}"
        font_bytes = download(f"{base}/{src.path}")
        verify(font_bytes, src.sha256, f"{key} font")
        variables[key] = font_bytes

        license_bytes = download(f"{base}/{src.license_path}")
        verify(license_bytes, src.license_sha256, f"{key} licence")
        (OUT / f"OFL-{src.family}.txt").write_bytes(license_bytes)

    for family, style, weight, axes in INSTANCES:
        font = build_instance(variables[family], family, style, weight, axes)
        check_coverage(font, f"{family} {style}")
        target = OUT / f"{family}-{style}.ttf"
        font.save(target)
        print(f"{target.relative_to(ROOT).as_posix():48} {target.stat().st_size / 1024:7.1f} KB  {axes}")

    total = sum(p.stat().st_size for p in OUT.glob("*.ttf")) / 1024
    print(f"total {total:.1f} KB")


if __name__ == "__main__":
    main()
