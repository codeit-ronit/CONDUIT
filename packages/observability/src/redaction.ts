import type { JsonValue } from "./json.js";

type SensitiveKind = "EMAIL" | "PHONE" | "PAYMENT" | "SECRET";

const DETECTORS: readonly {
  readonly kind: SensitiveKind;
  readonly expression: RegExp;
}[] = [
  {
    kind: "EMAIL",
    expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    kind: "PAYMENT",
    expression: /\b(?:\d[ -]*?){13,19}\b/gu,
  },
  {
    kind: "PHONE",
    expression: /(?<!\w)(?:\+?\d[\d ()-]{8,}\d)(?!\w)/gu,
  },
];

/** Session-scoped tokenization. Raw values remain only in this in-memory instance. */
export class RedactionSession {
  readonly #rawToToken = new Map<string, string>();
  readonly #counts = new Map<SensitiveKind, number>();

  public register(rawValue: string, kind: SensitiveKind = "SECRET"): string {
    if (rawValue.length === 0)
      throw new Error("Cannot register an empty sensitive value");
    return this.tokenFor(rawValue, kind);
  }

  public redactText(text: string): string {
    let redacted = text;
    const registered = [...this.#rawToToken.entries()].sort(
      ([left], [right]) => right.length - left.length,
    );
    for (const [raw, token] of registered) redacted = redacted.split(raw).join(token);
    for (const detector of DETECTORS) {
      redacted = redacted.replace(detector.expression, (match) =>
        this.tokenFor(match, detector.kind),
      );
    }
    return redacted;
  }

  public redactJson(value: JsonValue): JsonValue {
    if (typeof value === "string") return this.redactText(value);
    if (Array.isArray(value)) return value.map((item) => this.redactJson(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const sensitiveKind = sensitiveKindForKey(key);
          if (sensitiveKind && typeof child === "string" && child.length > 0) {
            return [key, this.tokenFor(child, sensitiveKind)];
          }
          return [key, this.redactJson(child)];
        }),
      );
    }
    return value;
  }

  private tokenFor(rawValue: string, kind: SensitiveKind): string {
    const existing = this.#rawToToken.get(rawValue);
    if (existing) return existing;
    const next = (this.#counts.get(kind) ?? 0) + 1;
    this.#counts.set(kind, next);
    const token = `<${kind}_${String(next)}>`;
    this.#rawToToken.set(rawValue, token);
    return token;
  }
}

function sensitiveKindForKey(key: string): SensitiveKind | null {
  const normalized = key.toLowerCase().replaceAll(/[_-]/gu, "");
  if (normalized.includes("email")) return "EMAIL";
  if (normalized.includes("phone") || normalized.includes("mobile")) return "PHONE";
  if (
    normalized.includes("card") ||
    normalized.includes("payment") ||
    normalized.includes("accountnumber")
  ) {
    return "PAYMENT";
  }
  if (
    normalized.includes("name") ||
    normalized.includes("address") ||
    normalized.includes("secret") ||
    normalized.includes("token")
  ) {
    return "SECRET";
  }
  return null;
}
