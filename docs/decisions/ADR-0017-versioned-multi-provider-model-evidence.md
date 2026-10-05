# ADR-0017: Version and separate multi-provider model evidence

- Status: Accepted
- Date: 2026-10-05

## Context

The bounded buyer already had an OpenAI adapter, but one optional demo call is not an
evaluation. It did not preserve the resolved model, request identity, latency, tokens,
repetitions, control arm, or denominator. It also could not show whether behaviour was
specific to one provider family.

Provider configuration creates another reporting risk: seeing an API key in the
environment does not mean a benchmark ran, and a mocked transport is not live-model
evidence.

## Decision

Use one provider-neutral `BuyerModel` contract with independent OpenAI Responses and
Google Gemini Interactions adapters. Both emit the same redacted telemetry shape:
provider, requested/resolved model, operation, outcome, time, request identifier, and
token usage. Prompts, outputs, and credentials are excluded from telemetry.

Freeze `conduit.live-model-eval.v1` before external execution. It contains seven named
attack classes, enabled and disabled-control arms, and five repetitions. With two
providers the full denominator is 140 trials. Reports distinguish `NOT_RUN`, `PARTIAL`,
and `COMPLETE`; configuration readiness never upgrades a report to live evidence.

The dashboard may show the contract and credential readiness without making a provider
call. Actual trials need an explicit runner and retain redacted trace digests rather
than putting raw prompts in the public report.

## Consequences

- A provider can change without changing tool authority or money rules.
- Comparisons have a frozen scenario digest and visible denominator.
- Missing token/cost data remains `null` instead of being guessed.
- The two unsolved problems—steering inside an allowed set and dishonest structured
  merchant data—are first-class limitations in the manifest.
- This decision does not claim that live trials have run. The control executor,
  credentials, real calls, and retained evidence are separate required work.

## Alternatives rejected

- **One successful live demo:** useful for wiring, but not robustness evidence.
- **Mix mocked and live results:** makes the evidence tier meaningless.
- **Store raw prompts in ordinary logs:** increases sensitive-data exposure and makes a
  public report unsafe to share.
- **Use only one model family:** cannot reveal provider-specific behaviour.
