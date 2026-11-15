// 浏览器内打标准 zip（STORE），与原生版一致，供编排页"选择项目文件夹"。
const SKIP = /^(node_modules|\.git|\.gradle|\.idea|\.vscode|__pycache__|\.next|\.nuxt|\.cache|\.pytest_cache|venv|\.venv|env)$/i
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0
  const u16 = n => new Uint8Array([n & 255, (n >>> 8) & 255])
  const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255])
  for (const f of files) {
    const name = enc.encode(f.path), data = f.data, crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    local.set(u32(0x04034b50), 0); local.set(u16(20), 4); local.set(u16(0x0800), 6)
    local.set(u16(0), 8); local.set(u16(0), 10); local.set(u16(0), 12)
    local.set(u32(crc), 14); local.set(u32(data.length), 18); local.set(u32(data.length), 22)
    local.set(u16(name.length), 26); local.set(u16(0), 28); local.set(name, 30)
    parts.push(local, data); central.push({ name, crc, size: data.length, offset })
    offset += 30 + name.length + data.length
  }
  let cdSize = 0; const cds = []
  for (const c of central) {
    const e = new Uint8Array(46 + c.name.length)
    e.set(u32(0x02014b50), 0); e.set(u16(20), 4); e.set(u16(20), 6); e.set(u16(0x0800), 8)
    e.set(u16(0), 10); e.set(u16(0), 12); e.set(u16(0), 14)
    e.set(u32(c.crc), 16); e.set(u32(c.size), 20); e.set(u32(c.size), 24)
    e.set(u16(c.name.length), 28); e.set(u16(0), 30); e.set(u16(0), 32)
    e.set(u16(0), 34); e.set(u16(0), 36); e.set(u32(0), 38); e.set(u32(c.offset), 42)
    e.set(c.name, 46); cds.push(e); cdSize += e.length
  }
  const eocd = new Uint8Array(22)
  eocd.set(u32(0x06054b50), 0); eocd.set(u16(0), 4); eocd.set(u16(0), 6)
  eocd.set(u16(central.length), 8); eocd.set(u16(central.length), 10)
  eocd.set(u32(cdSize), 12); eocd.set(u32(offset), 16); eocd.set(u16(0), 20)
  return new Blob([...parts, ...cds, eocd], { type: 'application/zip' })
}
export async function packFolder(fileList) {
  const list = [...fileList]
  if (!list.length) throw new Error('没有选择文件')
  const root = (list[0].webkitRelativePath || '').split('/')[0] || 'project'
  const picked = []
  for (const f of list) {
    const rel = (f.webkitRelativePath || '').split('/').slice(1).join('/')
    if (!rel) continue
    if (rel.split('/').some(s => SKIP.test(s))) continue
    if (/(^|\/)(Thumbs\.db|\.DS_Store)$/i.test(rel)) continue
    picked.push({ path: rel, file: f })
  }
  if (!picked.length) throw new Error('文件夹里没有可打包的文件')
  const total = picked.reduce((a, e) => a + e.file.size, 0)
  if (total > 400 * 1024 * 1024) throw new Error('文件夹超过 400MB，请清理构建产物或改用 zip')
  const packed = []
  for (const e of picked) packed.push({ path: e.path, data: new Uint8Array(await e.file.arrayBuffer()) })
  return { blob: zipStore(packed), root, count: picked.length, total }
}
export const extOk = (name, k) => {
  const n = name.toLowerCase()
  return k === 'build' || k === 'pr' ? /\.zip$/.test(n) : k === 'blender' ? /\.(blend|zip)$/.test(n)
    : /\.(mp4|mov|mkv|avi|webm|flv|wmv|m4v|ts|mp3|wav|aac|flac|m4a|ogg|wma)$/.test(n)
}