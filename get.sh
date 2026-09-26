#!/bin/sh
# Installs Nimbus for the current user, no sudo:
#   curl -fsSL https://raw.githubusercontent.com/MartinRovang/nimbus/main/get.sh | sh
# Puts `nimbus` (and the short `nb`) in ~/.local/bin, adds an app-menu entry and a desktop icon.
# Nimbus updates itself after this. NIMBUS_BIN=<path> installs a local build instead (install.sh does that).
set -e
REPO="MartinRovang/nimbus"
RAW="https://raw.githubusercontent.com/$REPO/main"
BIN="$HOME/.local/bin"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
DESK="$(xdg-user-dir DESKTOP 2>/dev/null || echo "$HOME/Desktop")"

[ "$(uname -s)-$(uname -m)" = "Linux-x86_64" ] || { echo "Nimbus: only Linux x86_64 builds are published so far"; exit 1; }
mkdir -p "$BIN" "$APPS" "$ICONS"

if [ -n "$NIMBUS_BIN" ]; then
  install -m755 "$NIMBUS_BIN" "$BIN/nimbus"
  install -m644 "$(dirname "$0")/src-tauri/icons/icon.png" "$ICONS/nimbus.png"
else
  echo "Downloading Nimbus…"
  # releases before the rename published the binary as nb-linux-x86_64
  curl -fsSL "https://github.com/$REPO/releases/latest/download/nimbus-linux-x86_64" -o "$BIN/nimbus.tmp" 2>/dev/null ||
    curl -fsSL "https://github.com/$REPO/releases/latest/download/nb-linux-x86_64" -o "$BIN/nimbus.tmp"
  chmod 755 "$BIN/nimbus.tmp" && mv "$BIN/nimbus.tmp" "$BIN/nimbus"
  curl -fsSL "$RAW/src-tauri/icons/icon.png" -o "$ICONS/nimbus.png"
fi
# `nb` stays as a short alias; it was the binary itself before the rename to Nimbus
ln -sf nimbus "$BIN/nb"
# launchers from before the rename
rm -f "$APPS/nb.desktop" "$DESK/nb.desktop" "$ICONS/nb.png"

# StartupWMClass is the app id the window reports (the Tauri identifier), so docks match it to this icon
cat > "$APPS/nimbus.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Nimbus
Comment=A quiet git IDE
Exec=$BIN/nimbus
Icon=$ICONS/nimbus.png
Terminal=false
Categories=Development;IDE;
StartupWMClass=com.martin.nb
EOF

if [ -d "$DESK" ]; then
  install -m755 "$APPS/nimbus.desktop" "$DESK/nimbus.desktop"
  gio set "$DESK/nimbus.desktop" metadata::trusted true 2>/dev/null || true
  # GNOME's desktop icons draw an untrusted launcher as a blank file and only look again when it changes
  touch "$DESK/nimbus.desktop"
fi

echo "Installed Nimbus: $BIN/nimbus (also 'nb'), app menu, $DESK/nimbus.desktop"
# Nimbus runs on the system WebKitGTK; say so up front rather than let the first launch fail
{ ldconfig -p 2>/dev/null || /sbin/ldconfig -p 2>/dev/null; } | grep -q libwebkit2gtk-4.1 || echo "Note: Nimbus needs WebKitGTK 4.1 (Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0)."
command -v git >/dev/null || echo "Note: Nimbus needs git."
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add $BIN to your PATH to run 'nimbus' from a terminal." ;; esac
