function encodeRFC5987Value(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, '%2A')
}

function asciiFallbackFilename(filename: string) {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/["\\]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return fallback || 'download.md'
}

export function contentDispositionHeader(disposition: 'inline' | 'attachment', filename: string) {
  return `${disposition}; filename="${asciiFallbackFilename(filename)}"; filename*=UTF-8''${encodeRFC5987Value(filename)}`
}
