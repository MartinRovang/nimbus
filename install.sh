#!/bin/sh
# Builds Nimbus from this checkout and installs it for the current user (no sudo), same layout as get.sh.
set -e
cd "$(dirname "$0")"
npm install
npx tauri build --no-bundle
NIMBUS_BIN=src-tauri/target/release/nimbus sh ./get.sh
