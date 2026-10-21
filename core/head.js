export const HEAD_LIMIT = 256 * 1024;

const MARKER = '</head';

const latin1 = (chunk) => {
  let out = '';
  for (let i = 0; i < chunk.length; i++) out += String.fromCharCode(chunk[i]);
  return out;
};

export const headScanner = () => {
  let tail = '';
  return (chunk) => {
    const text = tail + latin1(chunk).toLowerCase();
    tail = text.slice(-(MARKER.length - 1));
    return text.includes(MARKER);
  };
};

async function* chunksOf(body) {
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  } else {
    for await (const chunk of body) yield chunk;
  }
}

export const readHead = async (body, limit = HEAD_LIMIT) => {
  const seen = headScanner();
  const parts = [];
  let size = 0;
  for await (const chunk of chunksOf(body)) {
    parts.push(chunk);
    size += chunk.length;
    if (seen(chunk) || size >= limit) break;
  }
  const out = new Uint8Array(Math.min(size, limit));
  let at = 0;
  for (const part of parts) {
    const room = out.length - at;
    if (room <= 0) break;
    out.set(part.length > room ? part.subarray(0, room) : part, at);
    at += Math.min(part.length, room);
  }
  return out;
};
