#!/bin/sh
# Installs nb for the current user, no sudo:
#   curl -fsSL https://raw.githubusercontent.com/MartinRovang/nimbus/main/get.sh | sh
# Puts `nb` in ~/.local/bin, adds an app-menu entry and a desktop icon. nb updates itself after this.
# NB_BIN=<path> installs a local build instead of downloading the latest release (install.sh does that).
set -e
REPO="MartinRovang/nimbus"
RAW="https://raw.githubusercontent.com/$REPO/main"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"

[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "nb: only Linux x86_64 builds are published so far"; exit 1; }
mkdir -p "$BIN" "$APPS" "$ICONS"

if [ -n "$NB_BIN" ]; then
  install -m755 "$NB_BIN" "$BIN/nb"
  install -m644 "$(dirname "$0")/src-tauri/icons/icon.png" "$ICONS/nb.png"
else
  echo "Downloading nb…"
  curl -fsSL "https://github.com/$REPO/releases/latest/download/nb-linux-x86_64" -o "$BIN/nb.tmp"
  chmod 755 "$BIN/nb.tmp" && mv "$BIN/nb.tmp" "$BIN/nb"
  curl -fsSL "$RAW/src-tauri/icons/icon.png" -o "$ICONS/nb.png"
fi

cat > "$APPS/nb.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=nb
Comment=Minimal git IDE
Exec=$BIN/nb
Icon=$ICONS/nb.png
Terminal=false
Categories=Development;IDE;
StartupWMClass=nb
EOF

DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"
if [ -d "$DESK" ]; then
  install -m755 "$APPS/nb.desktop" "$DESK/nb.desktop"
  gio set "$DESK/nb.desktop" metadata::trusted true 2>/dev/null || true
  # GNOME's desktop icons draw an untrusted launcher as a blank file and only look again when it changes
  touch "$DESK/nb.desktop"
fi

echo "Installed nb: $BIN/nb, app menu, $DESK/nb.desktop"
# nb runs on the system WebKitGTK; say so up front rather than let the first launch fail
{ ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null; } | grep -q libwebkit2gtk-4.1 || echo "Note: nb needs WebKitGTK 4.1 (Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0)."
command -v git >/dev/null || echo "Note: nb needs git."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add $BIN to your PATH to run 'nb' from a terminal." ;; esac
