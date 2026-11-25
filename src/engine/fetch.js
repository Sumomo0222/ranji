// 带进度与缓存的二进制下载。优先走 Service Worker / HTTP 缓存，其次网络。
export async function fetchBinary(url, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** 资源是否已可离线使用（Service Worker 缓存里有） */
export async function isCached(url) {
  try {
    return (await caches?.match(url)) ? true : false;
  } catch (err) {
    return false;
  }
}

/** 字节数写成 MB 文本；超过 10 MB 时不带小数 */
export const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} MB`;
