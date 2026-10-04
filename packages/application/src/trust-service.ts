import type {
  CreateAuthorizationGrantInput,
  CreateBuyerInput,
  TrustedCommitInput,
} from "@conduit/contracts";
import {
  Money,
  authorizationGrantId,
  buyerId,
  cartId,
  merchantId,
  productId,
  purchaseOperationId,
  tenantId,
} from "@conduit/domain";
import type { AuthorizationGrant, PurchaseQuote } from "@conduit/domain";

import type {
  Buyer,
  PaymentProvider,
  ProviderResult,
  TrustRepository,
  TrustedCommitResult,
  TrustedPurchaseOperation,
} from "./trust-types.js";

export class TrustService {
  public constructor(
    private readonly repository: TrustRepository,
    private readonly provider: PaymentProvider,
  ) {}

  public createBuyer(input: CreateBuyerInput): Promise<Buyer> {
    return this.repository.createBuyer(tenantId(input.tenantId), input.displayName);
  }

  public createAuthorizationGrant(
    input: CreateAuthorizationGrantInput,
  ): Promise<AuthorizationGrant> {
    return this.repository.createAuthorizationGrant({
      tenantId: tenantId(input.tenantId),
      buyerId: buyerId(input.buyerId),
      merchantId: merchantId(input.merchantId),
      maximumAmount: money(input.maximumAmount),
      allowedCategories: input.allowedCategories,
      allowedSkus: input.allowedSkus,
      expiresAt: new Date(input.expiresAt),
      policyVersion: input.policyVersion,
    });
  }

  public revokeAuthorizationGrant(
    rawTenantId: string,
    rawGrantId: string,
  ): Promise<AuthorizationGrant> {
    return this.repository.revokeAuthorizationGrant(
      tenantId(rawTenantId),
      authorizationGrantId(rawGrantId),
    );
  }

  public commit(input: TrustedCommitInput): Promise<TrustedCommitResult> {
    return this.repository.prepareTrustedCommit({
      tenantId: tenantId(input.tenantId),
      cartId: cartId(input.cartId),
      grantId: authorizationGrantId(input.grantId),
      operationKey: input.operationKey,
      claimedQuote: quote(input.quote),
    });
  }

  /** Processes one durable command. A crash before this call leaves it in PostgreSQL. */
  public async processNextProviderCommand(): Promise<TrustedPurchaseOperation | null> {
    const command = await this.repository.claimNextProviderCommand();
    if (!command) return null;

    let result: ProviderResult;
    try {
      result = await this.provider.authorize(command);
    } catch {
      result = { outcome: "UNKNOWN", reference: `unknown:${command.operationKey}` };
    }
    return this.repository.completeProviderCommand(command, result, "AUTHORIZE");
  }

  /** UNKNOWN is queried at the provider; authorize is never blindly called again. */
  public async reconcileUnknown(
    rawOperationId: string,
  ): Promise<TrustedPurchaseOperation> {
    const command = await this.repository.findProviderCommand(
      purchaseOperationId(rawOperationId),
    );
    const result = await this.provider.lookup(command);
    return this.repository.completeProviderCommand(command, result, "RECONCILIATION");
  }
}

function quote(input: TrustedCommitInput["quote"]): PurchaseQuote {
  return {
    currency: input.currency,
    lines: input.lines.map((line) => ({
      productId: productId(line.productId),
      sku: line.sku,
      category: "",
      quantity: line.quantity,
      unitPrice: money(line.unitPrice),
      lineTotal: money(line.lineTotal),
      priceVersion: line.priceVersion,
    })),
    statedTotal: money(input.statedTotal),
  };
}

function money(input: {
  readonly currency: string;
  readonly minorUnits: string;
}): Money {
  return Money.fromMinorUnits(input.currency, BigInt(input.minorUnits));
}
