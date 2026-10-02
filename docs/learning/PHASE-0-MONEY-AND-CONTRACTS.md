# Phase 0 Learning Note: Money and Contracts

## What did we build?

Two deliberately small foundations:

- `@conduit/domain` contains business concepts with no network, database, framework, or
  model dependency.
- `@conduit/contracts` validates JSON that crosses a process or trust boundary.

The first business concept is `Money`.

## Why not use a JavaScript number?

JavaScript `number` uses binary floating point. Many decimal fractions cannot be
represented exactly, so arithmetic such as `0.1 + 0.2` does not equal `0.3` exactly.
Rounding later reduces visible errors but does not restore a lost invariant.

CONDUIT stores money as:

```text
(currency, integer minor units)
```

For INR, `19900n` means ₹199.00. The `n` marks a JavaScript `BigInt`, which is an exact
integer. There is no state in which the domain object contains ₹199.99 as an approximate
binary number.

## Why include currency in every value?

The integer `100` is meaningless by itself. It could mean ₹1.00, $1.00, or 100 units of
a zero-decimal currency. `Money` refuses to add different currencies. Currency
conversion must therefore be an explicit, separately auditable action.

## Why do JSON contracts use strings?

Standard JSON has no BigInt type. Sending a very large integer as a JSON number can lose
precision in a JavaScript client. We send minor units as a canonical decimal string:

```json
{ "currency": "INR", "minorUnits": "19900" }
```

The contracts reject decimals, exponential notation, leading zeroes, extra fields, and
malformed currencies. After validation, application code may safely convert `minorUnits`
to `BigInt`.

## Domain type versus transport contract

They look similar but serve different jobs:

- The **contract** distrusts raw external data and explains why it is invalid.
- The **domain value** makes invalid arithmetic difficult or impossible after data has
  entered the trusted core.

Keeping them separate prevents a web/API serialization concern from infecting business
logic.

## What do the tests prove?

- Floating-point inputs are rejected even if someone bypasses TypeScript.
- Arithmetic remains exact and immutable.
- Different currencies never combine implicitly.
- JSON serialization does not lose precision.
- Boundary schemas reject surprising shapes instead of silently accepting them.
- An architecture test fails if production domain code imports I/O, frameworks,
  infrastructure packages, or other CONDUIT layers.

## What is not solved yet?

- The three-letter format check does not prove that a currency is present in a specific
  ISO 4217 version. A versioned currency registry belongs at the application boundary
  later.
- `Money` permits negative values because ledgers need reversals. Individual use cases
  apply stricter contracts such as `nonNegativeMoneySchema`.
- Currency exponent/display formatting is not implemented.
- No catalog, cart, authorization, database, or payment code exists yet.
