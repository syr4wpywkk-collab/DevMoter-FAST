const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function normalizeApiAttachment(payload, file) {
  const attachment = payload?.attachment;
  if (
    !attachment ||
    typeof attachment !== "object" ||
    typeof attachment.id !== "string" || !ATTACHMENT_ID_PATTERN.test(attachment.id) ||
    typeof attachment.name !== "string" || !attachment.name ||
    !ALLOWED_IMAGE_TYPES.has(attachment.mime) || attachment.mime !== file?.type ||
    !Number.isSafeInteger(attachment.size) || attachment.size !== file?.size || attachment.size <= 0
  ) {
    throw new Error("API Chat received an invalid attachment response");
  }
  return attachment;
}
