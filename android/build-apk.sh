#!/usr/bin/env bash
set -euo pipefail
# Release-signing secrets are moved into unexported shell variables at once, so the
# compiler, git and SDK tools started below never inherit them.
release_keystore_b64="${ANDROID_KEYSTORE_BASE64:-}"
release_password="${ANDROID_KEYSTORE_PASSWORD:-}"
release_alias="${ANDROID_KEY_ALIAS:-}"
expected_cert_sha256="${ANDROID_SIGNING_CERT_SHA256:-}"
unset ANDROID_KEYSTORE_BASE64 ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_SIGNING_CERT_SHA256
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
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/zxing-classes"
# Fetch only the pinned upstream source revision; no dependency build scripts are run.
ZXING_COMMIT=f651b0a0375676e47144f73397dddff8868b0e4c
git init -q "$WORK/zxing"
git -C "$WORK/zxing" -c protocol.file.allow=never fetch -q --depth=1 --filter=blob:none https://github.com/zxing/zxing.git "$ZXING_COMMIT"
git -C "$WORK/zxing" sparse-checkout init --no-cone
git -C "$WORK/zxing" sparse-checkout set --no-cone /core/src/main/java/ /LICENSE /NOTICE
git -C "$WORK/zxing" -c core.hooksPath=/dev/null checkout -q --detach FETCH_HEAD
test "$(git -C "$WORK/zxing" rev-parse HEAD)" = "$ZXING_COMMIT"
find "$WORK/zxing/core/src/main/java" -name '*.java' -type f > "$WORK/zxing-sources.txt"
javac -encoding UTF-8 -source 8 -target 8 -d "$WORK/zxing-classes" @"$WORK/zxing-sources.txt"
jar cf "$WORK/zxing-core.jar" -C "$WORK/zxing-classes" .
"$TOOLS/aapt2" compile --dir res -o "$WORK/res.zip"
"$TOOLS/aapt2" link -I "$PLATFORM" --manifest AndroidManifest.xml -o "$WORK/resources.apk" "$WORK/res.zip"
javac -encoding UTF-8 -source 8 -target 8 -classpath "$PLATFORM:$WORK/zxing-core.jar" -d "$WORK/classes" src/app/devmoter/fast/*.java
jar cf "$WORK/classes.jar" -C "$WORK/classes" .
"$TOOLS/d8" --min-api 26 --lib "$PLATFORM" --output "$WORK/dex" "$WORK/classes.jar" "$WORK/zxing-core.jar"
cp "$WORK/resources.apk" "$WORK/unsigned.apk"
(cd "$WORK/dex" && zip -q ../unsigned.apk classes*.dex)
mkdir -p "$WORK/licenses/assets/licenses"
cp "$WORK/zxing/LICENSE" "$WORK/licenses/assets/licenses/zxing-LICENSE.txt"
cp "$WORK/zxing/NOTICE" "$WORK/licenses/assets/licenses/zxing-NOTICE.txt"
(cd "$WORK/licenses" && zip -q -r ../unsigned.apk assets)
"$TOOLS/zipalign" -p -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
if [[ -n "$release_keystore_b64" ]]; then
  : "${release_password:?ANDROID_KEYSTORE_PASSWORD is required with ANDROID_KEYSTORE_BASE64}"
  : "${release_alias:?ANDROID_KEY_ALIAS is required with ANDROID_KEYSTORE_BASE64}"
  KEYSTORE="$WORK/release.p12"
  (umask 077 && printf '%s' "$release_keystore_b64" | base64 -d > "$KEYSTORE")
  release_keystore_b64=""
  echo "Signing with the persistent release key"
  DEVMOTER_ANDROID_STORE_PASS="$release_password" DEVMOTER_ANDROID_KEY_PASS="$release_password" \
    "$TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$release_alias" --ks-pass env:DEVMOTER_ANDROID_STORE_PASS --key-pass env:DEVMOTER_ANDROID_KEY_PASS --out build/DevMoter-FAST.apk "$WORK/aligned.apk"
  release_password=""
  rm -f "$KEYSTORE"
else
  KEYSTORE="${DEVMOTER_ANDROID_KEYSTORE:-$HOME/.android/debug.keystore}"
  if [[ -z "${DEVMOTER_ANDROID_KEYSTORE:-}" ]]; then
    echo "::warning::No persistent release key configured; signing with an ephemeral debug key. APKs from different builds will not update each other."
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
fi
CERTS="$("$TOOLS/apksigner" verify --verbose --print-certs build/DevMoter-FAST.apk)"
echo "$CERTS"
if [[ -n "$expected_cert_sha256" ]]; then
  actual="$(echo "$CERTS" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | tr -d ':[:space:]' | tr 'A-F' 'a-f')"
  expected="$(echo "$expected_cert_sha256" | tr -d ':[:space:]' | tr 'A-F' 'a-f')"
  if [[ "$actual" != "$expected" ]]; then
    echo "Signing certificate SHA-256 $actual does not match ANDROID_SIGNING_CERT_SHA256" >&2
    exit 1
  fi
fi
"$TOOLS/aapt2" dump badging build/DevMoter-FAST.apk
(cd build && sha256sum DevMoter-FAST.apk > DevMoter-FAST.apk.sha256)
