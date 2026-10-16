# Release process

Official releases are produced from a version tag in this public repository.

1. Review the complete tag diff, dependencies, privacy impact, and build files.
2. Require passing CI, dependency audits, and desktop regression tests.
3. Build the Windows artifact in GitHub Actions from locked dependencies.
4. Generate SHA-256 checksums, an SPDX SBOM, and GitHub build provenance.
5. Before SignPath approval, publish the build as an **Unsigned preview**.
6. After approval, manually approve the SignPath request and publish the
   Authenticode-signed result as the primary download.

The maintainer never signs local, unreviewed, or third-party binaries with the
project's SignPath policy. Upstream open-source runtimes may be packaged without
being represented as Click Interval-produced binaries.

## Installation

Extract the portable Windows ZIP into a new folder and launch
`Click Interval.exe`. Do not overwrite an unrelated Click Interval edition.

## Uninstallation

Close Click Interval and delete the extracted application folder. The isolated
Auto Clicker + Macro edition stores durable user data under
`Documents\Click Interval Auto Macro` and private application state under
`%APPDATA%\click-interval-auto-macro`. Users may delete those folders if they
also want to remove their own macros and settings.
