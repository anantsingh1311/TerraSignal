// Shared safety helpers used across the API surface.
// Kept dependency-free so the backend stays on the Node standard library.

// Stripping control characters is the point of this expression.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// Text that reaches an LLM prompt from a user field or a third-party dataset
// (OSM tags, address labels) is untrusted. Neutralise the shapes that are used
// to smuggle instructions, and cap the length so a long field cannot dominate
// the prompt budget.
export const sanitizeForPrompt = (value, maxLength = 400) => {
  const text = String(value ?? "")
    .replace(CONTROL_CHARS, " ")
    .replace(/```+/g, " ")
    .replace(/<\/?(system|assistant|user|tool|function)[^>]*>/gi, " ")
    .replace(/\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system)\b/gi, "[redacted-instruction]")
    .replace(/\b(you\s+are\s+now|new\s+instructions?|system\s+prompt|developer\s+message)\b/gi, "[redacted-instruction]")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...[truncated]` : text;
};

// Recursively sanitise every string in a structure before it is embedded in a
// prompt. Depth-capped so a hostile payload cannot blow the stack.
export const sanitizeStructureForPrompt = (value, depth = 0) => {
  if (depth > 8) return "[depth-limit]";
  if (typeof value === "string") return sanitizeForPrompt(value, 600);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizeStructureForPrompt(item, depth + 1));
  if (value && typeof value === "object") {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 200)) {
      output[sanitizeForPrompt(key, 80)] = sanitizeStructureForPrompt(item, depth + 1);
    }
    return output;
  }
  return value;
};

// A fixed-capacity TTL store. The previous rate limiter used an unbounded Map,
// so a spray of distinct client keys grew the heap without limit.
export class BoundedTtlStore {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  sweep(nowMs = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= nowMs) this.entries.delete(key);
    }
    // Map preserves insertion order, so the head is the oldest write.
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get(key, nowMs = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key, entry) {
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) this.sweep();
    return entry;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  get size() {
    return this.entries.size;
  }
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => uuidPattern.test(String(value || ""));

// Trim free text that will be persisted and later rendered, so stored payloads
// stay bounded and control characters never reach a report or PDF.
export const safeText = (value, maxLength = 240, fallback = "") => {
  const text = String(value ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};
