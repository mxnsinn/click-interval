# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

This policy applies to the official repository, GitHub Actions workflows, and
release artifacts published at <https://github.com/mxnsinn/click-interval/releases>.

## Roles

- Committer and reviewer: [mxnsinn](https://github.com/mxnsinn)
- Approver: [mxnsinn](https://github.com/mxnsinn)

The maintainer uses multi-factor authentication for GitHub and will use it for
SignPath.
Pull requests from other contributors require maintainer review.
The maintainer manually approves every production signing request.

## Trusted build

Production Windows artifacts are built by `.github/workflows/release.yml` from
a tagged commit in this public repository. The workflow downloads the pinned
Python embeddable runtime from python.org, verifies its SHA-256 digest, installs
locked npm dependencies, runs the tests, builds the portable archive, and
uploads the unsigned artifact to SignPath through its official GitHub Action.

SignPath's artifact configuration must Authenticode-sign `Click Interval.exe`
inside the ZIP. Until SignPath approval is granted, public artifacts are
labeled **Unsigned preview**. After approval, the Authenticode-signed result—not
the unsigned SignPath input—will be the primary download. Checksums, an SBOM,
and GitHub build provenance accompany each release.

The internal Ed25519 signature is independent of Authenticode. It prevents an
installed application tree from being edited without detection and verifies
updates from the documented Click Interval update endpoint.

## User control and system changes

Click Interval does not contain a remote kill switch and cannot be remotely
disabled or uninstalled by the maintainer. A retired control URL remains as an
unused compatibility value for clients updating from versions 1.5.143 through
1.5.147; current code never requests or enforces it.

Update checks retrieve a signed manifest. The app downloads and installs an
update only after the local user selects the update action. Integrity failures
can block execution of an edited installation, but they cannot delete the app
or user data. Uninstallation is initiated locally by the user.

The application announces system changes before performing them. Server
software, add-ons, networking features, updates, and imported files are used
only when selected or configured by the operator.

## Privacy

See the [privacy policy](PRIVACY.md). Click Interval will not transfer any
information to other networked systems unless specifically requested by the
user or the person installing or operating it. The documented exceptions are
user-requested update checks/downloads, Minecraft downloads and metadata, and
optional server networking or voice-chat features.

## Artifact identity

The signing configuration must enforce `Click Interval` as the product name and
the repository version as the product/file version. Only artifacts produced by
the reviewed workflow from this repository may be submitted for signing.
