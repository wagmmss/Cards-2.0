export class PayloadTooLargeError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number, message?: string) {
    super(message || `Payload excede o limite máximo de ${Math.round(maxBytes / (1024 * 1024))}MB.`);
    this.name = 'PayloadTooLargeError';
    this.maxBytes = maxBytes;
  }
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === 'localhost' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    if (/^(127\.|10\.|169\.254\.|192\.168\.|0\.)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
    if (/^(?:fc00:|fd[0-9a-f]{2}:|fe80:)/i.test(host)) return false;
    // Block IPv4-mapped IPv6 addresses pointing to loopback/private/link-local ranges
    if (/^::ffff:/i.test(host)) {
      const mapped = host.slice(7);
      if (
        /^(127\.|10\.|169\.254\.|192\.168\.|0\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(mapped) ||
        /^(7f[0-9a-f]{2}:|a[0-9a-f]{2}:|a9fe:|c0a8:|0:|ac1[0-9a-f]:)/i.test(mapped)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function safeFetchWithRedirectValidation(
  rawUrl: string,
  init: RequestInit,
  maxRedirects = 3
): Promise<globalThis.Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!isSafeExternalUrl(currentUrl)) {
      throw new Error('URL externa inválida ou bloqueada por política SSRF.');
    }
    const resp = await fetch(currentUrl, {
      ...init,
      redirect: 'manual',
    });
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location || hop === maxRedirects) {
        throw new Error('Redirecionamento excessivo ou inválido ao buscar URL externa.');
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return resp;
  }
  throw new Error('Falha ao seguir redirecionamento seguro.');
}

/**
 * Streams an HTTP response body into a Buffer while enforcing a strict byte cap
 * before buffering everything into memory (protects against OOM on huge upstream files).
 */
export async function readResponseBufferWithLimit(
  resp: globalThis.Response,
  maxBytes: number
): Promise<Buffer> {
  const contentLengthHeader = resp.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      try {
        await resp.body?.cancel();
      } catch {
        // Ignore cancel failure
      }
      throw new PayloadTooLargeError(maxBytes);
    }
  }

  if (resp.body && typeof resp.body.getReader === 'function') {
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PayloadTooLargeError(maxBytes);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)), totalBytes);
  }

  const arrBuf = await resp.arrayBuffer();
  if (arrBuf.byteLength > maxBytes) {
    throw new PayloadTooLargeError(maxBytes);
  }
  return Buffer.from(arrBuf);
}
