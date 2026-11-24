export function normalizePropertyDescription(value: string) {
  return value.replace(/\r\n?/g, '\n').replace(/^[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
