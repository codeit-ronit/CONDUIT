import type { CartId } from "@conduit/domain";

import type { ModelledOrderProvider } from "./commerce-types.js";

/**
 * This provider performs no network or money movement. It gives the walking
 * skeleton a visible provider seam without pretending that settlement is real.
 */
export class DeterministicModelledOrderProvider implements ModelledOrderProvider {
  public referenceFor(cartId: CartId): string {
    return `modelled:${cartId}`;
  }
}
