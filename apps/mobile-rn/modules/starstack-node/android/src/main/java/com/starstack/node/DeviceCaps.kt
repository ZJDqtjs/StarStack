package com.starstack.node

import android.app.ActivityManager
import android.content.Context
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.os.Build
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * 把 Android 设备翻译成 Broker 认得的 hello 结构。
 * 与 cmd/worker 的 ffx.Detect 对应：os/arch/cpus/mem_mb/encoders/runtimes/gpus。
 * encoders 上报 MediaCodec 的硬件编码能力，命名用 h264_mediacodec / hevc_mediacodec，
 * 调度侧靠这个区分「移动硬编」与桌面 libx264 / NVENC。
 */
object DeviceCaps {

  fun arch(): String = if (Build.SUPPORTED_64_BIT_ABIS.isNotEmpty()) "arm64" else "arm"

  fun helloInfo(ctx: Context, nodeId: String, name: String, slots: Int, price: Double): JSONObject {
    val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val memMb = (am.memoryInfo.totalMem / (1024L * 1024L)).toInt()

    return JSONObject().apply {
      put("id", nodeId)
      put("name", name)
      put("price", price)
      put("slots", slots)
      put("os", "android/" + arch())
      put("arch", arch())
      put("cpus", Runtime.getRuntime().availableProcessors())
      put("mem_mb", memMb)
      put("device_id", deviceId(ctx))
      put("gpus", JSONArray())
      put("encoders", JSONArray(videoEncoders()))
      put(
        "runtimes",
        JSONArray().put(
          JSONObject()
            .put("name", "media")
            .put("version", "android-" + Build.VERSION.SDK_INT)
        )
      )
    }
  }

  /** 稳定设备指纹：只上报哈希，避免把 ANDROID_ID 原值交给平台。 */
  fun deviceId(ctx: Context): String {
    val raw = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
    val digest = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray())
    return digest.joinToString("") { "%02x".format(it) }.take(32)
  }

  /** 收集硬件视频编码器能力，映射成 Broker 侧可读的名字。 */
  fun videoEncoders(): List<String> {
    val out = LinkedHashSet<String>()
    val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
    for (info in list.codecInfos) {
      if (!info.isEncoder) continue
      // API 29+ 能区分硬编/软编；低版本不做区分，避免把 CPU 软编误报成闲置算力
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !info.isHardwareAccelerated) continue
      for (type in info.supportedTypes) {
        when (type) {
          "video/avc" -> out.add("h264_mediacodec")
          "video/hevc" -> out.add("hevc_mediacodec")
          "video/av01" -> out.add("av1_mediacodec")
          "video/x-vnd.on2.vp9" -> out.add("vp9_mediacodec")
        }
      }
    }
    return out.toList()
  }

  /** 该 MIME 硬编的码率上界，用于后续 MediaCodec 重编码时夹取参数。 */
  fun maxEncoderBitrate(mime: String): Int {
    val list = MediaCodecList(MediaCodecList.REGULAR_CODECS)
    for (info in list.codecInfos) {
      if (!info.isEncoder || !info.supportedTypes.contains(mime)) continue
      val caps = info.getCapabilitiesForType(mime)
      val video = caps.videoCapabilities ?: continue
      return video.bitrateRange.upper
    }
    return 8_000_000
  }
}
