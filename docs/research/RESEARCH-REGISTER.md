# Research and Validation Register

**Checked:** 2026-10-02

The rule for this file: record what a primary source or live system actually
says, the date checked, and the design effect. Documentation is evidence of a
published contract; only a live sandbox check is evidence of live behaviour.

## Current findings

| Topic | Verified finding | Design effect | Claim level |
|---|---|---|---|
| MCP | The 2026-07-28 release changed the core toward stateless requests and formal extensions. | Pin protocol/SDK versions; put state in explicit domain handles, not transport sessions. | Referenced |
| UCP | UCP now defines discoverable merchant capabilities, cart/checkout/order models, REST/MCP/A2A transports, and conformance tooling. | Use it as the first commerce compatibility target, not as our internal domain. | Referenced |
| ACP | ACP defines an agentic checkout surface and an MCP binding with five checkout tools; it is maintained by an open project founded by OpenAI and Stripe. | Keep an independent ACP adapter; do not conflate ACP with authorization. | Referenced |
| AP2 | Current AP2 v0.2 centers signed Checkout and Payment Mandates/Receipts and deterministic verification. This differs from the older intent/cart/payment description in the KT file. | Borrow authorization-chain ideas now; claim AP2 conformance only after implementing current cryptography and verification tests. | Referenced |
| x402 | x402 supports paid HTTP/tool calls and facilitator verify/settle flows. | Useful for machine-paid APIs, but not the default retail checkout rail in V1. | Referenced |
| Prompt injection | OWASP states prompt injection remains a core LLM-application risk; RAG/fine-tuning do not fully remove it. | Treat text isolation as mitigation and enforce permissions/effects outside the model. | Referenced |

## Primary sources

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Universal Commerce Protocol repository](https://github.com/universal-commerce-protocol/ucp)
- [UCP checkout specification](https://ucp.dev/latest/specification/checkout/)
- [Agentic Commerce Protocol repository](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol)
- [ACP MCP binding](https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/docs/mcp-binding.md)
- [AP2 v0.2 specification](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md)
- [Coinbase x402 facilitator documentation](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/verify-payment)
- [OWASP prompt-injection prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

## Facts still requiring live validation

Before a payment provider is selected or called “real,” record:

- provider/account name and sandbox mode;
- authentication and merchant tenancy model;
- discovered tool/API manifest and full argument schemas;
- idempotency semantics and retention window;
- order/payment state machine, webhook delivery, and reconciliation endpoints;
- designated sandbox failure instruments and timeout behaviour;
- refunds/reversals and currency/minor-unit rules;
- rate limits, data retention, PII treatment, and regional availability.

## Open research questions

1. Which payment provider and merchant account will the demo legally and
   practically use?
2. Should V1 demonstrate UCP REST, UCP-over-MCP, or both?
3. Which live model providers are available for broad evaluation, and what data
   may be sent to each?
4. What buyer/merchant identity provider should production use?
5. What external append-only service is appropriate for later audit anchoring?
