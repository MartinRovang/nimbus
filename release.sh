#!/bin/sh
# Publishes a signed Nimbus release on GitHub; every installed copy picks it up on its next start.
# Usage: ./release.sh 0.3.0   (notes come from the CHANGELOG.md section for that version)
# Needs: gh signed in, the repo below on GitHub, and the signing key from `tauri signer generate` at ~/.tauri/nimbus.key.
set -e
REPO="${NB_REPO:-MartinRovang/nimbus}"
V="$1"
[ -n "$V" ] || { echo "usage: ./release.sh <version> [notes]"; exit 1; }
cd "$(dirname "$0")"
# The notes are the version's CHANGELOG.md section (Nimbus shows the same text after updating)
NOTES="${2:-$(awk -v v="$V" '$0 ~ "^## "v" " {on=1; next} /^## / {on=0} on' CHANGELOG.md | sed '/^$/d')}"
[ -n "$NOTES" ] || { echo "Add a '## $V — <date>' section to CHANGELOG.md first."; exit 1; }

npm pkg set version="$V"
sed -i "s/^version = \".*\"/version = \"$V\"/" src-tauri/Cargo.toml
sed -i "s/^  \"version\": \".*\"/  \"version\": \"$V\"/" src-tauri/tauri.conf.json

npm install
npx tauri build --no-bundle

OUT=target-release
mkdir -p "$OUT"
cp src-tauri/target/release/nimbus "$OUT/nimbus-linux-x86_64"
npx tauri signer sign -f "$HOME/.tauri/nimbus.key" -p "" "$OUT/nimbus-linux-x86_64"

# The manifest the updater reads from releases/latest/download/latest.json
node -e '
const fs = require("fs"), [v, notes, repo, dir] = process.argv.slice(1);
fs.writeFileSync(dir + "/latest.json", JSON.stringify({
  version: v, notes, pub_date: new Date().toISOString(),
  platforms: { "linux-x86_64": {
    signature: fs.readFileSync(dir + "/nimbus-linux-x86_64.sig", "utf8"),
    url: `https://github.com/${repo}/releases/download/v${v}/nimbus-linux-x86_64`,
  } },
}, null, 2));
' "$V" "$NOTES" "$REPO" "$OUT"

git commit -qam "release v$V" || true
git tag "v$V"
git push -q --follow-tags
gh release create "v$V" "$OUT/nimbus-linux-x86_64" "$OUT/latest.json" --repo "$REPO" --title "v$V" --notes "$NOTES"
echo "Released v$V"
