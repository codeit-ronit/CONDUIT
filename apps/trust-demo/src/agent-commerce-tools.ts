import type {
  BuyerTools,
  CandidateProduct,
  CartView,
  CatalogToolResult,
  CommitToolResult,
} from "@conduit/agent-runtime";
import type { CommerceService, TrustService } from "@conduit/application";
import { trustedCommitSchema } from "@conduit/contracts";
import type { PricedCart, TenantId } from "@conduit/domain";
import type {
  BoundaryInvocationResult,
  ToolDescriptor,
  ToolExecutionResult,
  ToolRuntime,
} from "@conduit/enforcement";
import type { ToolBoundary } from "@conduit/enforcement";
import type { JsonValue } from "@conduit/observability";

interface AgentWorld {
  readonly tenantId: TenantId;
  readonly merchantId: string;
  readonly cartId: string;
  readonly grantId: string;
}

const objectSchema = (
  properties: Readonly<Record<string, JsonValue>>,
  required: readonly string[],
): JsonValue => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

const descriptors: readonly ToolDescriptor[] = [
  {
    providerId: "conduit-commerce-v1",
    name: "catalog.search",
    description: "Read structured catalog facts; return merchant prose separately.",
    inputSchema: objectSchema({ category: { type: "string" } }, ["category"]),
    outputSchema: objectSchema({ products: { type: "array" } }, ["products"]),
  },
  {
    providerId: "conduit-commerce-v1",
    name: "cart.set_line",
    description: "Set a reversible line and return a server-priced cart.",
    inputSchema: objectSchema(
      { productId: { type: "string" }, quantity: { type: "integer" } },
      ["productId", "quantity"],
    ),
    outputSchema: objectSchema({ cart: { type: "object" } }, ["cart"]),
  },
  {
    providerId: "conduit-commerce-v1",
    name: "cart.review",
    description: "Read the latest server-priced cart.",
    inputSchema: objectSchema({}, []),
    outputSchema: objectSchema({ cart: { type: "object" } }, ["cart"]),
  },
  {
    providerId: "conduit-commerce-v1",
    name: "purchase.commit",
    description: "Submit a stated total to the deterministic trusted commit gate.",
    inputSchema: objectSchema({ statedTotalMinorUnits: { type: "string" } }, [
      "statedTotalMinorUnits",
    ]),
    outputSchema: objectSchema({ result: { type: "object" } }, ["result"]),
  },
];

export class AgentCommerceToolRuntime implements ToolRuntime {
  public readonly providerId = "conduit-commerce-v1";

  public constructor(
    private readonly commerce: CommerceService,
    private readonly trust: TrustService,
    private readonly world: AgentWorld,
  ) {}

  public discoverTools(): Promise<readonly ToolDescriptor[]> {
    return Promise.resolve(descriptors);
  }

  public validateInput(toolName: string, input: JsonValue): boolean {
    if (!isRecord(input)) return false;
    if (toolName === "catalog.search")
      return onlyKeys(input, ["category"]) && typeof input.category === "string";
    if (toolName === "cart.set_line")
      return (
        onlyKeys(input, ["productId", "quantity"]) &&
        typeof input.productId === "string" &&
        Number.isInteger(input.quantity)
      );
    if (toolName === "cart.review") return onlyKeys(input, []);
    if (toolName === "purchase.commit")
      return (
        onlyKeys(input, ["statedTotalMinorUnits"]) &&
        typeof input.statedTotalMinorUnits === "string" &&
        /^\d+$/u.test(input.statedTotalMinorUnits)
      );
    return false;
  }

  public async execute(
    toolName: string,
    input: JsonValue,
  ): Promise<ToolExecutionResult> {
    if (!isRecord(input)) throw new Error("Tool input must be an object");
    if (toolName === "catalog.search") {
      const products = await this.commerce.listProducts(
        this.world.tenantId,
        this.world.merchantId,
      );
      const category = stringValue(input.category, "category");
      return {
        structuredData: {
          products: products
            .filter((product) => product.category === category)
            .map((product): JsonValue => ({
              productId: String(product.id),
              sku: product.sku,
              category: product.category,
              attributes: attributesJson(product.attributes),
              unitPriceMinorUnits: product.price.minorUnits.toString(),
              availableQuantity: product.availableQuantity,
            })),
        },
        untrustedText: products.map(
          (product) => `${product.displayName}: ${product.description}`,
        ),
        claimLevel: "MODELLED",
      };
    }
    if (toolName === "cart.set_line") {
      const cart = await this.commerce.setCartLine({
        tenantId: this.world.tenantId,
        cartId: this.world.cartId,
        productId: stringValue(input.productId, "productId"),
        quantity: Number(input.quantity),
      });
      return {
        structuredData: { cart: cartJson(cart) },
        untrustedText: [],
        claimLevel: "MODELLED",
      };
    }
    if (toolName === "cart.review") {
      const cart = await this.currentCart();
      return {
        structuredData: { cart: cartJson(cart) },
        untrustedText: [],
        claimLevel: "MODELLED",
      };
    }
    if (toolName === "purchase.commit") {
      const cart = await this.currentCart();
      const commit = await this.trust.commit(
        trustedCommitSchema.parse({
          tenantId: this.world.tenantId,
          cartId: cart.id,
          grantId: this.world.grantId,
          operationKey: `agent:${crypto.randomUUID()}`,
          quote: quoteFrom(
            cart,
            stringValue(input.statedTotalMinorUnits, "statedTotalMinorUnits"),
          ),
        }),
      );
      let provider = null;
      if (commit.outcome === "PENDING_PROVIDER") {
        provider = await this.trust.processNextProviderCommand();
      }
      return {
        structuredData: { result: serializeCommit(commit, provider) },
        untrustedText: [],
        claimLevel: "MODELLED",
      };
    }
    throw new Error("Unknown agent commerce tool");
  }

  private currentCart(): Promise<PricedCart> {
    return this.commerce.getCart({
      tenantId: this.world.tenantId,
      cartId: this.world.cartId,
    });
  }
}

export class BoundaryBackedBuyerTools implements BuyerTools {
  readonly #calls: BoundaryInvocationResult[] = [];

  public constructor(
    private readonly boundary: ToolBoundary,
    private readonly tenantId: TenantId,
    private readonly runId: string,
  ) {}

  public get calls(): readonly BoundaryInvocationResult[] {
    return this.#calls;
  }

  public async searchCatalog(category: string): Promise<CatalogToolResult> {
    const call = await this.invoke("catalog.search", { category });
    const value = resultObject(call);
    const products = Array.isArray(value.products) ? value.products : [];
    return {
      products: products.map(candidateProduct),
      untrustedTextObserved: (call.result?.quarantinedText.length ?? 0) > 0,
    };
  }

  public async setCartLine(productId: string, quantity: number): Promise<CartView> {
    const call = await this.invoke("cart.set_line", { productId, quantity });
    return parseCart(resultObject(call).cart);
  }

  public async reviewCart(): Promise<CartView> {
    const call = await this.invoke("cart.review", {});
    return parseCart(resultObject(call).cart);
  }

  public async commit(
    statedTotalMinorUnits: string,
    humanApprovalId?: string,
  ): Promise<CommitToolResult> {
    const input = { statedTotalMinorUnits };
    let call = await this.invoke("purchase.commit", input);
    if (call.decision.outcome === "REQUIRE_APPROVAL" && humanApprovalId) {
      call = await this.invoke("purchase.commit", input, humanApprovalId);
    }
    if (call.decision.outcome !== "ALLOW") {
      return {
        outcome: call.decision.outcome === "DENY" ? "DENIED" : "REQUIRES_APPROVAL",
        reason: call.decision.reason,
        recoveryAction: call.decision.recoveryAction,
        evidence: { forwarded: false },
      };
    }
    return parseCommit(resultObject(call).result);
  }

  private async invoke(
    toolName: string,
    input: JsonValue,
    humanApprovalId?: string,
  ): Promise<BoundaryInvocationResult> {
    const call = await this.boundary.invoke({
      tenantId: this.tenantId,
      runId: this.runId,
      toolName,
      input,
      correlationId: `agent:${crypto.randomUUID()}`,
      ...(humanApprovalId === undefined ? {} : { humanApprovalId }),
    });
    this.#calls.push(call);
    return call;
  }
}

export async function approveAgentTools(
  boundary: ToolBoundary,
  tenantId: TenantId,
): Promise<void> {
  await boundary.approveDiscoveredTool(tenantId, "catalog.search", "READ_ONLY");
  await boundary.approveDiscoveredTool(tenantId, "cart.set_line", "REVERSIBLE_WRITE");
  await boundary.approveDiscoveredTool(tenantId, "cart.review", "READ_ONLY");
  await boundary.approveDiscoveredTool(tenantId, "purchase.commit", "BINDING_WRITE");
}

function cartView(cart: PricedCart): CartView {
  return {
    cartId: cart.id,
    currency: cart.total.currency,
    totalMinorUnits: cart.total.minorUnits.toString(),
    lines: cart.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceMinorUnits: line.unitPrice.minorUnits.toString(),
      lineTotalMinorUnits: line.lineTotal.minorUnits.toString(),
    })),
  };
}

function cartJson(cart: PricedCart): JsonValue {
  const value = cartView(cart);
  return {
    cartId: value.cartId,
    currency: value.currency,
    totalMinorUnits: value.totalMinorUnits,
    lines: value.lines.map((line) => ({ ...line })),
  };
}

function attributesJson(
  attributes: Readonly<Record<string, string | boolean | readonly string[]>>,
): JsonValue {
  const output: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    output[key] =
      typeof value === "string" || typeof value === "boolean"
        ? value
        : value.map(String);
  }
  return output;
}

function quoteFrom(cart: PricedCart, statedTotalMinorUnits: string) {
  return {
    currency: cart.total.currency,
    lines: cart.lines.map((line) => ({
      productId: line.productId,
      sku: line.sku,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toJSON(),
      lineTotal: line.lineTotal.toJSON(),
      priceVersion: line.priceVersion,
    })),
    statedTotal: { currency: cart.total.currency, minorUnits: statedTotalMinorUnits },
  };
}

function serializeCommit(
  commit: Awaited<ReturnType<TrustService["commit"]>>,
  provider: unknown,
): JsonValue {
  if (
    commit.outcome === "PENDING_PROVIDER" &&
    isRecord(provider) &&
    provider.status === "CONFIRMED"
  ) {
    return {
      outcome: "CONFIRMED",
      chargedMinorUnits: commit.operation.total.minorUnits.toString(),
      evidence: {
        decision: commit.decision.reason,
        providerStatus: provider.status,
        operationId: stringValue(provider.id, "operationId"),
        orderId: stringValue(provider.orderId, "orderId"),
        providerReference: stringValue(provider.providerReference, "providerReference"),
      },
    };
  }
  if (commit.outcome === "REPLAYED") {
    return {
      outcome: commit.operation.status === "CONFIRMED" ? "CONFIRMED" : "DENIED",
      chargedMinorUnits: commit.operation.total.minorUnits.toString(),
      evidence: { replayed: true, status: commit.operation.status },
    };
  }
  return {
    outcome: commit.outcome,
    reason: commit.decision.reason,
    recoveryAction: commit.decision.recoveryAction ?? "Review the server quote.",
    evidence: {
      gates: commit.gates.map((gate) => ({ key: gate.key, status: gate.status })),
    },
  };
}

function resultObject(call: BoundaryInvocationResult): Record<string, JsonValue> {
  if (!call.result || !isRecord(call.result.structured.value))
    throw new Error(
      `Tool ${call.reconciliation.toolName} did not return structured output`,
    );
  return call.result.structured.value;
}

function candidateProduct(value: JsonValue): CandidateProduct {
  if (!isRecord(value)) throw new Error("Candidate product was not an object");
  return {
    productId: stringValue(value.productId, "productId"),
    sku: stringValue(value.sku, "sku"),
    category: stringValue(value.category, "category"),
    attributes: parseAttributes(value.attributes),
    unitPriceMinorUnits: stringValue(value.unitPriceMinorUnits, "unitPriceMinorUnits"),
    availableQuantity: Number(value.availableQuantity),
  };
}

function parseCart(value: JsonValue | undefined): CartView {
  if (!isRecord(value) || !Array.isArray(value.lines))
    throw new Error("Cart tool returned an invalid cart");
  return {
    cartId: stringValue(value.cartId, "cartId"),
    currency: stringValue(value.currency, "currency"),
    totalMinorUnits: stringValue(value.totalMinorUnits, "totalMinorUnits"),
    lines: value.lines.map((line) => {
      if (!isRecord(line)) throw new Error("Cart line was not an object");
      return {
        productId: stringValue(line.productId, "productId"),
        sku: stringValue(line.sku, "sku"),
        quantity: Number(line.quantity),
        unitPriceMinorUnits: stringValue(
          line.unitPriceMinorUnits,
          "unitPriceMinorUnits",
        ),
        lineTotalMinorUnits: stringValue(
          line.lineTotalMinorUnits,
          "lineTotalMinorUnits",
        ),
      };
    }),
  };
}

function parseCommit(value: JsonValue | undefined): CommitToolResult {
  if (!isRecord(value)) throw new Error("Commit tool returned invalid output");
  if (value.outcome === "CONFIRMED") {
    return {
      outcome: "CONFIRMED",
      chargedMinorUnits: stringValue(value.chargedMinorUnits, "chargedMinorUnits"),
      evidence: value.evidence ?? {},
    };
  }
  return {
    outcome: value.outcome === "REQUIRES_APPROVAL" ? "REQUIRES_APPROVAL" : "DENIED",
    reason: stringValue(value.reason, "reason"),
    recoveryAction: stringValue(value.recoveryAction, "recoveryAction"),
    evidence: value.evidence ?? {},
  };
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function parseAttributes(value: JsonValue | undefined): CandidateProduct["attributes"] {
  if (!isRecord(value)) return {};
  const attributes: Record<string, string | boolean | readonly string[]> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || typeof item === "boolean") {
      attributes[key] = item;
    } else if (Array.isArray(item) && item.every((part) => typeof part === "string")) {
      attributes[key] = item;
    }
  }
  return attributes;
}

function onlyKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length && expected.every((key) => actual.includes(key))
  );
}
