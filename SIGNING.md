# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Roles

- Committer and reviewer: [mxnsinn](https://github.com/mxnsinn)
- Approver: [mxnsinn](https://github.com/mxnsinn)

The maintainer will use multi-factor authentication for GitHub and SignPath.
Pull requests from other contributors require maintainer review.
The maintainer manually approves every production signing request.

## Trusted build

Production Windows artifacts are built by `.github/workflows/release.yml` from
a tagged commit in this public repository. The workflow downloads the pinned
Python embeddable runtime from python.org, verifies its SHA-256 digest, installs
locked npm dependencies, runs the tests, builds the portable archive, and
uploads the unsigned artifact to SignPath through its official GitHub Action.

SignPath's artifact configuration must Authenticode-sign `Click Interval.exe`
inside the ZIP. The signed result—not the unsigned input—is published.

The internal Ed25519 signature is independent of Authenticode. It prevents an
installed application tree from being edited without detection and verifies
updates from the documented Click Interval update endpoint.
