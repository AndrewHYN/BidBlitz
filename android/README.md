# BidBlitz for Android

The launcher opens https://www.bidblitz.co.zw/ in a Trusted Web Activity using Google's Android Browser Helper. The browser handles sign-in, cookies, file selection and outbound links. The marketplace requires an internet connection. A browser with Custom Tabs support can show its toolbar if it cannot verify the domain.

## Build and sign

Install JDK 17, Android SDK Platform 36 and Build Tools 35.0.0. From this directory, run `./gradlew :app:assembleRelease`. The unsigned APK is under `app/build/outputs/apk/release/`.

Sign the APK with Android Build Tools `apksigner sign --ks /private/path/bidblitz-release.p12 --ks-key-alias bidblitz --out BidBlitz.apk app/build/outputs/apk/release/app-release-unsigned.apk`. Enter the keystore password when prompted. Run `apksigner verify --verbose --print-certs BidBlitz.apk` and compare its SHA-256 certificate fingerprint with `../public/.well-known/assetlinks.json`.

Keep the release key private. Retain the application ID and signing key and increase the version code in `app/build.gradle` for future APK updates. If Google Play App Signing is enabled later, add the Play app-signing certificate fingerprint to the domain association before distributing through Play.
