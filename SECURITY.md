# Security policy

Please report vulnerabilities through GitHub's private vulnerability reporting
feature. Do not include private user data in a public issue.

Supported releases are the latest published stable release. Security fixes are
published through the same reviewed GitHub Actions and SignPath workflow.

Official release artifacts include SHA-256 checksums, an SPDX SBOM, and GitHub
build provenance. Verify downloads against the files attached to the matching
GitHub release. Preview artifacts are unsigned until SignPath Foundation
approval is complete and are labeled accordingly.

Click Interval does not remotely disable or uninstall an installation. A local
integrity check may refuse to launch files that no longer match the signed
application manifest; reinstalling an official release restores those files.
