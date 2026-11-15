package com.starstack.node

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Broker 协议客户端。端点与 cmd/worker 完全一致：
 *   POST /api/worker/hello  注册/心跳，返回 {id, claim_code, owned, secret}
 *   GET  /api/claim         长轮询领分片，204 表示空闲
 *   POST /api/report        进度（running / uploading / idle / failed）
 *   POST /api/upload        回传产物（Broker 重新算 SHA-256 后结算）
 */
class NodeApi(private val base: String) {
  private val jsonMedia = "application/json; charset=utf-8".toMediaType()

  val http: OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(75, TimeUnit.SECONDS)
    .writeTimeout(180, TimeUnit.SECONDS)
    .build()

  private fun url(path: String) = base.trimEnd('/') + path
  private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

  fun hello(info: JSONObject, launchCode: String?, nodeSecret: String?): JSONObject? {
    val builder = Request.Builder()
      .url(url("/api/worker/hello"))
      .post(info.toString().toRequestBody(jsonMedia))
    if (!launchCode.isNullOrEmpty()) builder.header("X-Launch-Code", launchCode)
    if (!nodeSecret.isNullOrEmpty()) builder.header("X-Node-Secret", nodeSecret)
    http.newCall(builder.build()).execute().use { res ->
      val text = res.body?.string().orEmpty()
      if (!res.isSuccessful) throw IllegalStateException("注册被拒 ${res.code}: ${text.take(240)}")
      if (text.isBlank()) return null
      return JSONObject(text)
    }
  }

  fun claim(nodeId: String, nodeSecret: String, waitSec: Int = 20): JSONObject? {
    val builder = Request.Builder().url(url("/api/claim?worker=${enc(nodeId)}&wait=$waitSec")).get()
    if (nodeSecret.isNotEmpty()) builder.header("X-Node-Secret", nodeSecret)
    http.newCall(builder.build()).execute().use { res ->
      if (res.code == 204) return null
      val text = res.body?.string().orEmpty()
      if (!res.isSuccessful) throw IllegalStateException("领活失败 ${res.code}: ${text.take(240)}")
      return if (text.isBlank()) null else JSONObject(text)
    }
  }

  fun report(nodeId: String, nodeSecret: String, segId: String, state: String, pct: Int = 0) {
    val body = JSONObject().apply {
      put("worker", nodeId)
      put("seg", segId)
      put("state", state)
      put("pct", pct)
    }
    val builder = Request.Builder()
      .url(url("/api/report"))
      .post(body.toString().toRequestBody(jsonMedia))
    if (nodeSecret.isNotEmpty()) builder.header("X-Node-Secret", nodeSecret)
    http.newCall(builder.build()).execute().use { }
  }

  fun fail(nodeId: String, nodeSecret: String, segId: String, reason: String) {
    val body = JSONObject().apply {
      put("worker", nodeId)
      put("seg", segId)
      put("state", "failed")
      put("err", reason.take(600))
    }
    val builder = Request.Builder()
      .url(url("/api/report"))
      .post(body.toString().toRequestBody(jsonMedia))
    if (nodeSecret.isNotEmpty()) builder.header("X-Node-Secret", nodeSecret)
    http.newCall(builder.build()).execute().use { }
  }

  fun download(srcUrl: String, dst: File) {
    val request = Request.Builder().url(srcUrl).get().build()
    http.newCall(request).execute().use { res ->
      if (!res.isSuccessful) throw IllegalStateException("下载源片失败 ${res.code}")
      val body = res.body ?: throw IllegalStateException("下载源片为空")
      dst.parentFile?.mkdirs()
      body.byteStream().use { input ->
        dst.outputStream().use { out -> input.copyTo(out, 256 * 1024) }
      }
    }
  }

  /** 回传产物。Broker 会重算 SHA-256 并在响应里给出它自己的哈希，用于后续 done 回报。 */
  fun upload(segId: String, nodeId: String, file: File): Pair<String, Long> {
    val part = MultipartBody.Builder()
      .setType(MultipartBody.FORM)
      .addFormDataPart("file", file.name, file.asRequestBody("application/octet-stream".toMediaType()))
      .build()
    val request = Request.Builder()
      .url(url("/api/upload?seg=${enc(segId)}&worker=${enc(nodeId)}"))
      .post(part)
      .build()
    http.newCall(request).execute().use { res ->
      val text = res.body?.string().orEmpty()
      if (!res.isSuccessful) {
        throw IllegalStateException("回传产物失败 ${res.code}: ${text.take(240)}")
      }
      val jo = runCatching { JSONObject(text) }.getOrNull()
      val sha = jo?.optString("sha").orEmpty()
      val bytes = jo?.optLong("bytes", file.length()) ?: file.length()
      return sha to bytes
    }
  }

  /**
   * 分片完成回报。只 upload 不 done 的话，Broker 只落了盘、不会结算，
   * 分片会一直停在 uploading 直到租约超时被回收重派 —— 这是 cmd/worker 里
   * finish() 的第三步，别漏。
   */
  fun done(
    nodeId: String,
    nodeSecret: String,
    segId: String,
    sha: String,
    bytes: Long,
    wallSec: Double,
    speed: Double
  ) {
    val body = JSONObject().apply {
      put("worker", nodeId)
      put("seg", segId)
      put("state", "done")
      put("sha", sha)
      put("bytes", bytes)
      put("wall", wallSec)
      put("speed", speed)
    }
    val builder = Request.Builder()
      .url(url("/api/report"))
      .post(body.toString().toRequestBody(jsonMedia))
    if (nodeSecret.isNotEmpty()) builder.header("X-Node-Secret", nodeSecret)
    http.newCall(builder.build()).execute().use { }
  }
}
