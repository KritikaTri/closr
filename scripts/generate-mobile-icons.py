from pathlib import Path
import json

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"

icon = Image.open(ASSETS / "icon-only.png").convert("RGBA")
foreground = Image.open(ASSETS / "icon-foreground.png").convert("RGBA")
background = Image.open(ASSETS / "icon-background.png").convert("RGBA")

android_res = ROOT / "android/app/src/main/res"
for density, size in {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}.items():
    folder = android_res / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher.png")
    icon.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher_round.png")

for filename in ("ic_launcher.xml", "ic_launcher_round.xml"):
    (android_res / "mipmap-anydpi-v26" / filename).write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n',
        encoding="utf-8",
    )

for density, size in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
    folder = android_res / f"mipmap-{density}"
    foreground.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher_foreground.png")
    background.resize((size, size), Image.Resampling.LANCZOS).save(folder / "ic_launcher_background.png")

colors = android_res / "values/colors.xml"
colors.write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources>\n'
    '    <color name="ic_launcher_background">#E7F2E9</color>\n'
    '</resources>\n',
    encoding="utf-8",
)

ios_icon_dir = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
ios_icon_dir.mkdir(parents=True, exist_ok=True)
icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(ios_icon_dir / "AppIcon-512@2x.png")
(ios_icon_dir / "Contents.json").write_text(
    json.dumps({
        "images": [{
            "filename": "AppIcon-512@2x.png",
            "idiom": "universal",
            "platform": "ios",
            "size": "1024x1024",
        }],
        "info": {"author": "xcode", "version": 1},
    }, indent=2) + "\n",
    encoding="utf-8",
)
print("Generated Closer launcher icons for Android and iOS.")
