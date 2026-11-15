package com.starstack.node

import android.content.Context
import android.os.Build
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * 常驻节点循环：注册 → 长轮询领分片 → 下载 → 切分 → 回传。
 * 全部跑在 Kotlin 前台 Service 的协程里，不依赖 JS 运行时，所以退到后台不会被挂起。
 *
 * 域名/协议与 cmd/worker 一致；差异只在执行器（MediaCodec 系 vs ffmpeg 子进程）。
 */
class NodeRunner(
  private val ctx: Context,
  private val baseUrl: String,
  private val launchCode: String,
  nodeIdHint: String,
  private val slots: Int,
  private val price: Double,
  private val onPhase: (String, Map<String, Any>) -> Unit
) {
  private val api = NodeApi(baseUrl)
  private var job: Job? = null

  @Volatile private var stopped = false
  private var nodeId: String = nodeIdHint
  private var secret: String = ""
  private var served: Int = 0
  private var lastIdleAt: Long = 0
  private var encoder: String = ""

  fun start(scope: CoroutineScope) {
    job = scope.launch { runLoop() }
  }

  fun stop() {
    stopped = true
    job?.cancel()
  }

  private suspend fun runLoop() {
    try {
      hello()
      while (!stopped) {
        val claim = withContext(Dispatchers.IO) { api.claim(nodeId, secret) }
        if (claim == null) {
          idleHeartbeat()
          continue
        }
        handle(claim)
      }
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      onPhase(
        "error",
        mapOf("lastError" to (e.message ?: "未知错误"), "nodeId" to nodeId)
      )
    }
  }

  private fun hello() {
    val displayName = "android-" + Build.MODEL.replace(' ', '-')
    val info = DeviceCaps.helloInfo(ctx, nodeId, displayName, slots, price)
    encoder = DeviceCaps.videoEncoders().firstOrNull().orEmpty()
    val res = api.hello(info, launchCode.ifEmpty { null }, secret.ifEmpty { null })
    if (res != null) {
      res.optString("id").takeIf { it.isNotEmpty() }?.let { nodeId = it }
      res.optString("secret").takeIf { it.isNotEmpty() }?.let { secret = it }
    }
    onPhase("polling", mapOf("nodeId" to nodeId, "encoder" to encoder))
  }

  private suspend fun handle(claim: JSONObject) {
    val segId = claim.optString("seg_id")
    val srcUrl = claim.optString("src_url")
    val start = claim.optDouble("start", 0.0)
    val dur = claim.optDouble("dur", 0.0)
    val kind = claim.optString("kind", "")
    if (segId.isEmpty() || srcUrl.isEmpty()) return

    if (kind.isNotEmpty() && kind != "transcode") {
      api.fail(nodeId, secret, segId, "Android 节点暂只接转码分片（收到 kind=$kind）")
      return
    }

    val workDir = File(ctx.cacheDir, "segments").apply { mkdirs() }
    val src = File(workDir, "$segId.src")
    val out = File(workDir, "$segId.mp4")

    try {
      onPhase("fetching", mapOf("segId" to segId, "pct" to 0))
      withContext(Dispatchers.IO) { api.download(srcUrl, src) }

      api.report(nodeId, secret, segId, "running", 30)
      onPhase("transcoding", mapOf("segId" to segId, "pct" to 30))

      val ok = withContext(Dispatchers.IO) { SegmentCutter.cut(src, out, start, dur) }
      if (!ok) throw IllegalStateException("切分失败：源片没有可用视频轨或区间越界")

      api.report(nodeId, secret, segId, "uploading", 80)
      onPhase("uploading", mapOf("segId" to segId, "pct" to 80))
      withContext(Dispatchers.IO) { api.upload(segId, nodeId, out) }

      served += 1
      onPhase("polling", mapOf("served" to served, "segId" to "", "pct" to 100))
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      runCatching { api.fail(nodeId, secret, segId, e.message ?: "执行失败") }
      onPhase("error", mapOf("lastError" to (e.message ?: "执行失败")))
    } finally {
      src.delete()
      out.delete()
    }
  }

  /** 空闲心跳：既让 Broker 记为在线，也顺手刷新租约。 */
  private fun idleHeartbeat() {
    val now = System.currentTimeMillis()
    if (now - lastIdleAt < 15_000) return
    lastIdleAt = now
    runCatching { api.report(nodeId, secret, "", "idle") }
  }
}
