/** Strip obvious XSS vectors from teacher-authored rich text. */
export function sanitizeRichText(html) {
  if (!html || typeof html !== 'string') return null;
  const cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .trim();
  return cleaned || null;
}
