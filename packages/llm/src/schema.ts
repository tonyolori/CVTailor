import { z, type ZodType } from "zod";

type Json = Record<string, unknown>;

const UNSUPPORTED = [
  "$schema",
  "default",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "propertyNames",
  "maxItems",
];

const ALLOWED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/** Limit on nullable or anyOf parameters per schema in strict structured outputs. */
export const MAX_ANYOF_PARAMS = 16;

/**
 * JSON Schema for structured output: unsupported constraints removed (zod still enforces
 * them on the reply), every object closed, every property required, optional ones nullable.
 * Docs: platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations
 */
export function toStrictJsonSchema(schema: ZodType): { schema: Json; anyOfCount: number } {
  const raw = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Json;
  let anyOfCount = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node == null || typeof node !== "object") return node;
    const out: Json = {};
    for (const [k, v] of Object.entries(node as Json)) {
      if (UNSUPPORTED.includes(k)) continue;
      if (k === "format" && !ALLOWED_FORMATS.has(String(v))) continue;
      if (k === "minItems") {
        out.minItems = Math.min(Number(v), 1);
        continue;
      }
      out[k] = k === "properties" ? mapValues(v as Json, walk) : walk(v);
    }
    if (out.anyOf) anyOfCount++;
    if (out.type === "object" && out.properties) {
      const props = out.properties as Json;
      const required = new Set((out.required as string[]) ?? []);
      const rawProps = ((node as Json).properties ?? {}) as Record<string, Json>;
      const inputOptional = Object.keys(props).filter((p) => !required.has(p));
      for (const key of inputOptional) {
        // A field with a default is simply required: the model fills it in, so it needn't be nullable.
        const hasDefault = rawProps[key]?.default !== undefined;
        if (!hasDefault && !allowsNull(props[key] as Json)) {
          props[key] = { anyOf: [props[key], { type: "null" }] };
          anyOfCount++;
        }
      }
      out.required = Object.keys(props);
      out.additionalProperties = false;
    }
    return out;
  };

  return { schema: walk(raw) as Json, anyOfCount };
}

function allowsNull(node: Json): boolean {
  if (node.type === "null") return true;
  if (Array.isArray(node.type) && node.type.includes("null")) return true;
  return Array.isArray(node.anyOf) && node.anyOf.some((n) => (n as Json).type === "null");
}

function mapValues(obj: Json, fn: (v: unknown) => unknown): Json {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

/** Optional fields come back as null from a strict schema. Removing them lets zod apply its own defaults. */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Json)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)]),
    );
  }
  return value;
}

/** Zod-validate a model reply. Issues name the field path only, so they're safe to log. */
export function validateReply<T>(
  schema: ZodType<T>,
  value: unknown,
): { ok: true; data: T } | { ok: false; error: string; forModel: string } {
  const parsed = schema.safeParse(stripNulls(value));
  if (parsed.success) return { ok: true, data: parsed.data };
  const paths = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`);
  const forModel = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
  return { ok: false, error: `invalid fields: ${paths.slice(0, 8).join("; ")}`, forModel };
}

/** Pull a JSON value out of a reply that may be wrapped in a code fence. */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[{[]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("no JSON in reply");
  return JSON.parse(candidate.slice(start, end + 1));
}
