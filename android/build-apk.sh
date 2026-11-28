#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
: "${SDK:?Set ANDROID_HOME or ANDROID_SDK_ROOT}"
TOOLS="$SDK/build-tools/35.0.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
for tool in aapt2 d8 zipalign apksigner; do test -x "$TOOLS/$tool"; done
test -f "$PLATFORM"
mkdir -p build
WORK="$(mktemp -d build/apk.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/classes" "$WORK/dex"
"$TOOLS/aapt2" compile --dir res -o "$WORK/res.zip"
"$TOOLS/aapt2" link -I "$PLATFORM" --manifest AndroidManifest.xml -o "$WORK/resources.apk" "$WORK/res.zip"
javac -source 8 -target 8 -classpath "$PLATFORM" -d "$WORK/classes" src/app/devmoter/fast/MainActivity.java
jar cf "$WORK/classes.jar" -C "$WORK/classes" .
"$TOOLS/d8" --min-api 26 --lib "$PLATFORM" --output "$WORK/dex" "$WORK/classes.jar"
cp "$WORK/resources.apk" "$WORK/unsigned.apk"
(cd "$WORK/dex" && zip -q ../unsigned.apk classes.dex)
"$TOOLS/zipalign" -p -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
KEYSTORE="${DEVMOTER_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
if [[ -z "${DEVMOTER_ANDROID_KEYSTORE:-}" ]]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  if [[ ! -e "$KEYSTORE" ]]; then
    keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias androiddebugkey -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000
  fi
  export DEVMOTER_ANDROID_STORE_PASS=android DEVMOTER_ANDROID_KEY_PASS=android
  DEVMOTER_ANDROID_KEY_ALIAS=androiddebugkey
fi
: "${DEVMOTER_ANDROID_STORE_PASS:?Set keystore password}"
: "${DEVMOTER_ANDROID_KEY_PASS:?Set key password}"
: "${DEVMOTER_ANDROID_KEY_ALIAS:?Set key alias}"
"$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$DEVMOTER_ANDROID_KEY_ALIAS" --ks-pass env:DEVMOTER_ANDROID_STORE_PASS --key-pass env:DEVMOTER_ANDROID_KEY_PASS --out build/DevMoter-FAST.apk "$WORK/aligned.apk"
"$TOOLS/apksigner" verify --verbose --print-certs build/DevMoter-FAST.apk
"$TOOLS/aapt2" dump badging build/DevMoter-FAST.apk
(cd build && sha256sum DevMoter-FAST.apk > DevMoter-FAST.apk.sha256)
