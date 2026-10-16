# Click Interval 1.5.148 — Unsigned preview

This is the first public, reproducible preview of the isolated **Auto Clicker +
Macro** edition. It is being published before SignPath Foundation approval so
the source-to-binary build can be reviewed publicly.

## Included

- Auto Clicker
- Macro recorder, editor, import, and playback
- Local settings and macro storage isolated from other Click Interval editions
- Signed update-manifest verification
- Application-file integrity verification
- Wine/CrossOver compatibility safeguards

## Security and user control

- This release has no remote kill switch.
- The maintainer cannot remotely disable or uninstall the application.
- Updates are installed only after the local user chooses to update.
- No analytics or advertising SDKs are included.
- CI publishes an SPDX SBOM, SHA-256 checksum, and build provenance.

## Signature status

**This preview is not Authenticode-signed yet.** Free code signing provided by
SignPath.io, certificate by SignPath Foundation, is being requested. Once the
project is approved, the signed artifact will replace the unsigned preview as
the primary download.

See the [code signing policy](https://github.com/mxnsinn/click-interval/blob/main/SIGNING.md),
[privacy policy](https://github.com/mxnsinn/click-interval/blob/main/PRIVACY.md), and
[installation/uninstallation instructions](https://github.com/mxnsinn/click-interval/blob/main/RELEASE.md).
