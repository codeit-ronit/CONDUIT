# ADR-0015: Require external evidence before adding product breadth

**Status:** Accepted  
**Date:** 2026-10-05

## Context

Phases 0–7 established correct commerce, authorization, enforcement, evaluation, and
protocol boundaries. Most evidence is nevertheless local: scripted/flawed models,
modelled payments, a localhost merchant, and clients implemented in the same repository.
Adding another protocol or UI would not prove that the system works against a real
model, provider, independent agent, or user.

The current trusted buyer handoff is valid for a human-present flow, but it does not
exercise the autonomous delegated-spending purpose of the authorization ledger. The
database grant is also not a portable credential that another merchant can verify.

## Decision

- Pause new protocol and product-surface breadth.
- Position the immediate V1 as an evidence-grade reference merchant and safety testbed,
  not a universal intermediary in the payment path.
- Keep ordinary payment correctness as load-bearing infrastructure, while treating
  delegated authorization, effect enforcement, and real-model evaluation as the
  AI-specific contribution.
- Support two explicit authorization modes:
  - human present, using the existing trusted review surface;
  - human not present, added only after a signed, agent-bound, constrained authorization
    can be verified and replay-controlled.
- Prioritize, in order: stable order evidence, multi-provider live-model evaluation,
  Razorpay Test Mode, signed authorization, public independent-agent interoperability,
  and external use.
- Keep every claim labelled MODELLED, TESTED, SANDBOX, INTEROPERABLE, or PILOTED.
- Describe prompt-injection controls as effect containment. Do not claim they prevent
  all steering, dishonest merchant data, or poor choices within an allowed set.

## Consequences

The existing modules remain useful; this is a validation reordering, not a rewrite.
Modelled providers and scripted agents continue to provide deterministic regression
tests but cannot close external-evidence gates. UCP remains the selected commerce edge;
ACP, x402, new consoles, generalized merchant features, and SENTINEL integration are
deferred.

The repository can later support a long-tail merchant product or business-agent spend
governance product, but V1 will not attempt both. External usage will decide which, if
either, deserves product investment.
