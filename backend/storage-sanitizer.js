const nulCharacter = String.fromCharCode(0);

export const sanitizeStorageText = (value, fallback = "") =>
  String(value ?? fallback).split(nulCharacter).join("");

export const sanitizeForStorage = (value) => {
  if (typeof value === "string") {
    return sanitizeStorageText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForStorage(item));
  }

  if (value && typeof value === "object") {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [sanitizeStorageText(key), sanitizeForStorage(item)]),
    );
  }

  return value;
};

// PostgreSQL JSONB and TEXT values cannot contain NUL bytes. Keeping this
// cleanup here makes storage rules explicit without coupling analysis logic to
// a specific database engine.
export const toStorageJson = (value) => JSON.stringify(sanitizeForStorage(value ?? null));
