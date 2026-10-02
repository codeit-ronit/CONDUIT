# Contributing to CONDUIT

This project optimizes for correctness and understanding, not commit volume.

## Branch and commit workflow

- `main` must stay runnable and is the source of truth.
- Use short branches named `feat/...`, `fix/...`, `docs/...`, or `test/...`.
- Make one conceptual change per commit.
- Use conventional subjects such as `feat(domain): add integer Money value` or
  `docs(adr): record commit transaction boundary`.
- Never commit secrets, real customer data, generated evaluation output, local
  databases, or model cassettes containing sensitive content.

## Before a commit

Run the repository check command (to be added in Phase 0). It will cover
formatting, linting, type checking, tests, migrations, and dependency rules.
Until then, use `git diff --check` and review the staged diff.

## What a pull request must explain

1. What behaviour changed?
2. Why is the change needed?
3. What invariant or user value does it support?
4. How was it tested, including the failure path?
5. What remains unhandled?

## Documentation rule

- Update `docs/PROJECT-LOG.md` for each completed slice.
- Add or supersede an ADR for choices that are expensive to reverse.
- Update the research register when a live API or published specification is
  checked; include the date, version, and evidence.
- Do not change a claim from MODELLED to REAL without a reproducible sandbox
  artifact or test report.

## Release approach

Use semantic versions after the first runnable vertical slice:

- patch: fixes with no contract change;
- minor: backward-compatible capability;
- major: incompatible public contract or persisted-data change.

Until then, milestones use `v0.0.x` tags. No tag is created merely for planning
documents; the first tag should identify an executable, tested slice.
