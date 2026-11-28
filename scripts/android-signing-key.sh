#!/usr/bin/env bash
# Creates the persistent Android release signing key once and stores it as
# GitHub Actions secrets. Run on the owner's own machine (needs keytool, gh, openssl).
set -euo pipefail
REPO="${1:-syr4wpywkk-collab/DevMoter-FAST}"
OUT="${DEVMOTER_ANDROID_KEY_DIR:-$HOME/.devmoter/android-signing}"
KEYSTORE="$OUT/devmoter-release.p12"
ALIAS="devmoter-release"
for tool in keytool gh openssl base64; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
if [[ -e "$KEYSTORE" ]]; then
  echo "$KEYSTORE already exists; refusing to replace the release key." >&2
  exit 1
fi
umask 077
mkdir -p "$OUT"
password="$(openssl rand -base64 33 | tr -d '\n/+=')"
# 10950 days = 30 years; the password reaches keytool only through this one command's environment.
DEVMOTER_KS_PASS="$password" keytool -genkeypair -storetype PKCS12 -keystore "$KEYSTORE" \
  -storepass:env DEVMOTER_KS_PASS -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10950 \
  -dname "CN=DevMoter FAST, O=DevMoter"
printf '%s\n' "$password" > "$KEYSTORE.password"
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$password" | gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$REPO"
printf '%s' "$ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
password=""
fingerprint="$(keytool -list -v -storetype PKCS12 -keystore "$KEYSTORE" -alias "$ALIAS" -storepass:file "$KEYSTORE.password" \
  | sed -n 's/^[[:space:]]*SHA256: //p' | head -1)"
gh variable set ANDROID_SIGNING_CERT_SHA256 --repo "$REPO" --body "$fingerprint"
cat <<MSG
Release key created and stored as GitHub secrets for $REPO.
Certificate SHA-256: $fingerprint
Back up both files somewhere safe (a password manager or encrypted storage), then delete the password file:
  $KEYSTORE
  $KEYSTORE.password
Losing the key means installed APKs can no longer be updated in place.
MSG
