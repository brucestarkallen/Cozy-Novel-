export const id = (prefix = "r") => `${prefix}_${crypto.randomUUID()}`;
export const now = () => new Date().toISOString();
export async function textBlob(text) {
  if (typeof text !== "string")
    throw new TypeError("Text must remain a string.");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return {
    id:
      "text_" +
      Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    text,
  };
}
export const clone = (value) => structuredClone(value);
