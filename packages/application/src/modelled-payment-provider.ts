import type {
  PaymentProvider,
  ProviderCommand,
  ProviderResult,
} from "./trust-types.js";

/**
 * Deterministic provider for demos/tests. `unknown` simulates a network timeout after
 * a provider may have acted; lookup then proves the final result without a second charge.
 */
export class ModelledPaymentProvider implements PaymentProvider {
  private readonly outcomes = new Map<string, "SUCCEEDED" | "DECLINED">();

  public authorize(command: ProviderCommand): Promise<ProviderResult> {
    const final = command.operationKey.includes("decline") ? "DECLINED" : "SUCCEEDED";
    this.outcomes.set(command.operationKey, final);
    if (command.operationKey.includes("unknown")) {
      return Promise.resolve({
        outcome: "UNKNOWN",
        reference: `modelled:${command.operationKey}`,
      });
    }
    return Promise.resolve({
      outcome: final,
      reference: `modelled:${command.operationKey}`,
    });
  }

  public lookup(command: ProviderCommand): Promise<ProviderResult> {
    const outcome = this.outcomes.get(command.operationKey);
    if (!outcome) {
      return Promise.resolve({
        outcome: "UNKNOWN",
        reference: `modelled:${command.operationKey}`,
      });
    }
    return Promise.resolve({ outcome, reference: `modelled:${command.operationKey}` });
  }
}
