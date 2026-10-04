# MCP 2026-07-28 implementation note

**Checked:** 2026-10-04  
**Evidence type:** official specification/SDK documentation and executable local test  
**Implementation claim:** official SDK transport used; UCP MCP conformance not claimed

## Findings used

1. The official TypeScript SDK v2 implements the MCP `2026-07-28` modern protocol era
   through separate server, client, and Node transport packages.
2. Streamable HTTP servers can be created with `createMcpHandler`; Node's adapter
   supplies `toNodeHandler` and localhost Host/Origin protections.
3. Authentication remains a resource-server concern. The handler accepts `AuthInfo`, but
   CONDUIT must verify a bearer before dispatch and pass only the derived principal.
4. UCP's catalog MCP binding defines `search_catalog` and requires the calling
   platform's profile in `meta["ucp-agent"].profile`.
5. Production MCP authorization should use the current OAuth resource-server model where
   applicable. A pre-established API key is retained only for the bounded local UCP
   demo.

## Implementation choices

- Pin `@modelcontextprotocol/server` and client to `2.3.0`, Node transport to `2.1.1`,
  and the client negotiation mode to `2026-07-28`.
- Register one read-only `search_catalog` tool with a strict Zod input schema.
- Verify bearer, bind UCP agent identity, and negotiate the exact UCP catalog capability
  before calling the catalog source.
- Use JSON response mode for a small stateless local demonstration.
- Test through the official client rather than calling the registered function directly.

## Known gap

The official high-level server converts a `ProtocolError` raised by a tool callback into
a normal MCP tool result with `isError: true`. The UCP binding's exact transport error
rules may require a different JSON-RPC envelope for some authentication and negotiation
failures. The denial is safe and tested, but exact binding conformance is therefore
explicitly withheld.

## Primary sources

- [Official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [MCP Streamable HTTP guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/http.md)
- [MCP authorization guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/authorization.md)
- [UCP catalog MCP binding](https://ucp.dev/2026-08-25/specification/shopping/catalog/mcp/)
