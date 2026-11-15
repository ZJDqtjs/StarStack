import type { HttpReq, Resp, UploadReq } from './client'

const JSON_TIMEOUT = 20_000
const UPLOAD_TIMEOUT = 180_000

async function run(url: string, init: RequestInit, ms: number): Promise<Resp> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    return { status: res.status, text: await res.text() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // fetch 的网络层错误没有 status，交给上层按 0 处理
    return { status: 0, text: JSON.stringify({ error: '网络不可达：' + msg }) }
  } finally {
    clearTimeout(timer)
  }
}

export function request(req: HttpReq): Promise<Resp> {
  return run(req.url, { method: req.method, headers: req.headers, body: req.body }, JSON_TIMEOUT)
}

export function upload(req: UploadReq): Promise<Resp> {
  // 不要手动设置 Content-Type：RN 会自动补 multipart boundary
  return run(req.url, { method: req.method, headers: req.headers, body: req.form }, UPLOAD_TIMEOUT)
}
