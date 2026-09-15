"""Turn the downloaded exercise photos into the WebP set the app ships.

`scripts/mirror-exercise-images.mjs --download-only` pulls the Free Exercise DB
photos (public domain, 1 746 JPEGs at 850x567, ~98 MB) into `.exercise-images/`,
which is git-ignored. This converts them to 640px WebP — about 42 MB, small
enough to live in the repository — under `apps/web/public/exercises/`, keeping
the source tree so `3_4_Sit-Up/0.jpg` becomes `3_4_Sit-Up/0.webp`.

Why in the repo rather than Supabase Storage: the pictures never change, they
are wanted in development and CI as much as in production, and serving them as
static assets keeps them off the project's storage egress.

    python scripts/webp-exercise-images.py            # convert what is missing
    python scripts/webp-exercise-images.py --force    # redo everything

Needs Pillow (`pip install pillow`). Re-runs skip files that already exist.
"""

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".exercise-images"
TARGET = ROOT / "apps" / "web" / "public" / "exercises"
WIDTH = 640
QUALITY = 80
FORCE = "--force" in sys.argv


def convert(path: Path) -> int:
    """One file; returns the bytes written, or 0 when it was already there."""
    out = TARGET / path.parent.name / (path.stem + ".webp")
    if out.exists() and not FORCE:
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(path).convert("RGB")
    if image.width > WIDTH:
        height = round(image.height * WIDTH / image.width)
        image = image.resize((WIDTH, height), Image.LANCZOS)
    image.save(out, "WEBP", quality=QUALITY, method=6)
    return out.stat().st_size


def main() -> None:
    if not SOURCE.exists():
        sys.exit(
            f"{SOURCE} not found. Run: node scripts/mirror-exercise-images.mjs --download-only"
        )
    files = sorted(SOURCE.glob("*/*.jpg"))
    if not files:
        sys.exit(f"No .jpg files under {SOURCE}")

    with ThreadPoolExecutor(max_workers=8) as pool:
        written = list(pool.map(convert, files))

    made = sum(1 for size in written if size)
    total = sum(written)
    print(
        f"{made} converted, {len(files) - made} already there, "
        f"{total / 1024 / 1024:.1f} MB written to {TARGET.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
