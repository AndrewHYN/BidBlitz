# Public Android installer

The 1.0.0 parts reconstruct the original signed APK at build time. The build checks its SHA-256 before publishing it. These are public installer bytes only, not the signing key. To update, preserve the package and signing identity, bump the version, and update the assembly script and download link.
