# Third-party dependencies

The release jar contains only Click Interval coordinator classes. Dependencies
are not shaded into it.

| Dependency | Pinned build | Use | License |
| --- | --- | --- | --- |
| Velocity API | 4.2.0 | Compile-time API | MIT |
| Velocity proxy | 4.2.0 | Runtime proxy | GPL-3.0 |
| Adventure | Version supplied by Velocity | Player messages | MIT |
| JUnit Jupiter | 5.11.4 | Tests only | EPL-2.0 |

NanoLimbo is a separate process supervised by Click Interval, not a linked or
redistributed dependency of this plugin. NanoLimbo 1.13.0 is GPL-3.0 and its
published SHA-256 is
`884dc3d4941fb0964dfd348cebc66afb692b156a213cc980d6f47f02441432cf`.

Source and license references:

- https://github.com/PaperMC/Velocity
- https://github.com/KyoriPowered/adventure
- https://github.com/junit-team/junit5
- https://github.com/Nan1t/NanoLimbo
