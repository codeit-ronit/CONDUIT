# Phase 8, slice 1: The live-model evidence foundation

## What did we build?

We connected a second real model-provider adapter—Google Gemini—beside the existing
OpenAI adapter. Both implement the same buyer contract, so changing the model does not
change what the agent is allowed to do.

Each provider call now produces redacted telemetry: which provider and model handled the
operation, whether it completed/refused/failed validation, how long it took, token
counts when supplied, and a provider request ID. We deliberately do not record the API
key, raw prompt, or raw answer in that event.

We also froze `conduit.live-model-eval.v1`. It defines:

- ten attacks and failure modes;
- clean control, unguarded injection, structured-only, spotlighting, and
  quarantined-reader arms;
- five repetitions per arm;
- two required providers;
- separate measurements for unauthorized effects, steering, malformed output, latency,
  tokens, and measured cost.

That is 10 × 5 × 5 × 2 = **500 planned trials**.

## Why is a versioned contract important?

If we choose attacks after seeing a model's answers, we can make the result look better
than it is. Freezing the test first gives every run the same questions and creates a
SHA-256 manifest digest. Repetitions expose randomness; the denominator prevents a claim
such as “zero failures” from hiding whether that meant 2 runs or 2,000.

## What can the user see?

The Evidence Lab has a Phase 8 readiness card showing the scenarios, denominator,
manifest digest, and whether each provider is configured. The Agent Lab can run either
the OpenAI or Gemini adapter after its server-side environment variables are supplied.

The readiness card makes no network call and is labelled `READINESS_ONLY`. A configured
credential is not a completed experiment.

## What is proven now?

- Both provider adapters compile behind the same strict schemas.
- Mocked transport tests prove that provider-specific response metadata is normalized
  into the shared telemetry contract.
- The experiment runner refuses one-shot manifests, skips unconfigured targets, reports
  denominators, and keeps steering separate from hard unauthorized effects.

## What is not proven yet?

- No real OpenAI or Gemini request was made in this slice because no credentials were
  supplied to the workspace.
- The 500-trial result table does not exist yet.
- The control-ablation executor and durable redacted trace store are the next slice.
- The kernel cannot prove that an in-policy selection was unbiased;
  clean-versus-injected steering is therefore a headline measurement.
- The kernel cannot detect a merchant lie already accepted as trusted structured data.

## Next step

Build the evaluation-only ablation executor, retain redacted trial evidence, then run
the frozen manifest with explicit model IDs and credentials. Only after both providers
finish should Phase 8 become complete and the report be published.

## Slice 2 direction

The manifest now treats steering as a first-class result. Its arms are clean control,
raw injected content, structured-only input, spotlighted untrusted text, and a
quarantined-reader result. The prompt builder makes those differences explicit while
remaining outside the authority path; it cannot authorize a purchase. The suite also
names MCP description poisoning, schema rug-pulls, and PII exfiltration so the next
executor can measure attack classes reviewers recognize.
