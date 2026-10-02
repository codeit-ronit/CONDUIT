# CONDUIT

CONDUIT is a trust layer for agentic commerce: an AI agent may choose what to buy, but
deterministic software decides what may be charged.

The project is being rebuilt from first principles. The previous project's knowledge
transfer is preserved in [CONDUIT-KT.md](CONDUIT-KT.md), but it is an input—not the new
architecture.

## Start here

1. [Project Guide](docs/PROJECT-GUIDE.md) — the problem, thesis, scope, and our learning
   agreement.
2. [V1 Plan](docs/plans/V1-PLAN.md) — what we will build and the exit test for every
   slice.
3. [Architecture](docs/ARCHITECTURE.md) — component boundaries and purchase flow in
   plain language.
4. [Decision Log](docs/DECISIONS.md) — every important choice, including why it was made
   and what would make us revisit it.
5. [Research Register](docs/research/RESEARCH-REGISTER.md) — verified facts, changing
   standards, and open questions.
6. [Project Log](docs/PROJECT-LOG.md) — dated progress and lessons.
7. [Contributing Guide](CONTRIBUTING.md) — branch, commit, review, and release
   discipline.
8. [Learning Notes](docs/learning/README.md) — plain-language explanations of each
   implemented slice.

## Current status

**Phase 3: enforcement boundary and audit.** Runtime tool discovery, approved schema
snapshots, fail-closed interception, trust labels, permission narrowing, central PII
tokenization, and a gapless hash-chained PostgreSQL audit are operational. Payment and
tool effects remain explicitly MODELLED; no real money moves.

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm db:setup
pnpm check
pnpm demo:commerce
```

For the visual phase-by-phase demo:

```bash
pnpm demo:web
```

Then open <http://127.0.0.1:4310>. Switch between **Purchase safety** and **Tool
boundary**. The second workspace visualizes quarantine, permission narrowing, human
approval, unknown tools, schema drift, PII tokenization, and concurrent audit.

On macOS, Docker Desktop or Docker CLI with Colima may provide the Docker engine. See
the [database learning note](docs/learning/PHASE-0-DATABASE.md) for the mental model and
all database commands.

## The three rules to remember

- The agent chooses; the system charges.
- Money comes from catalog truth and integer arithmetic, never model output.
- Every external effect passes through one deterministic enforcement boundary.
