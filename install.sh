#!/bin/sh
# Builds nb and installs it for the current user (no sudo):
# `nb` command in ~/.local/bin, an app-menu entry, and a launcher icon on the desktop.
# Updates after this arrive by themselves (see release.sh).
set -e
cd "$(dirname "$0")"

npm install
npx tauri build --no-bundle

BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$BIN" "$APPS" "$ICONS"
install -m755 src-tauri/target/release/nb "$BIN/nb"
install -m644 src-tauri/icons/icon.png "$ICONS/nb.png"

cat > "$APPS/nb.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=nb
Comment=Minimal git IDE
Exec=$BIN/nb
Icon=nb
Terminal=false
Categories=Development;IDE;
StartupWMClass=nb
EOF

DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESK" ]; then
  install -m755 "$APPS/nb.desktop" "$DESK/nb.desktop"
  gio set "$DESK/nb.desktop" metadata::trusted true 2>/dev/null || true
fi

echo "Installed: $BIN/nb, app menu entry, $DESK/nb.desktop"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add $BIN to your PATH to run 'nb' from a terminal." ;; esac
