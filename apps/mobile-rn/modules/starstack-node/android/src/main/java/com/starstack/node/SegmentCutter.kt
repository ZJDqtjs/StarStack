package com.starstack.node

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * v0 执行器：按时间区间做「无重编码切分」（stream copy）。
 *
 * 为什么先做这个：MediaCodec 硬编输出的 SPS/PPS、GOP 与桌面 libx264 不一致，
 * Broker 的 `concat -c copy` 要求各分片编码参数一致，否则接缝会花。
 * stream copy 保证分片参数与源片完全一致，先把「领活 → 下载 → 切分 → 回传 → 校验 → 合并」
 * 整条协议链路跑通；真正的参数改写（MediaCodec 重编码）见 TODO。
 *
 * TODO(media-codec): 用 MediaCodec 硬编按 Claim 的 vcodec/height/q 重编码，
 *   输出 mkv（Broker 目前按 mkv 合并，MediaMuxer 只支持 mp4/webm，需要 ffmpeg-kit 或 Broker 侧兼容 mp4）。
 */
object SegmentCutter {

  fun cut(src: File, dst: File, startSec: Double, durSec: Double): Boolean {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(src.absolutePath)

      var videoTrack = -1
      var audioTrack = -1
      for (i in 0 until extractor.trackCount) {
        val fmt = extractor.getTrackFormat(i)
        val mime = fmt.getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/") && videoTrack < 0) videoTrack = i
        if (mime.startsWith("audio/") && audioTrack < 0) audioTrack = i
      }
      if (videoTrack < 0) return false

      val muxer = MediaMuxer(dst.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      val mapped = LinkedHashMap<Int, Int>()
      mapped[videoTrack] = muxer.addTrack(extractor.getTrackFormat(videoTrack))
      if (audioTrack >= 0) mapped[audioTrack] = muxer.addTrack(extractor.getTrackFormat(audioTrack))
      muxer.start()

      val startUs = (startSec * 1_000_000.0).toLong()
      val endUs = ((startSec + durSec) * 1_000_000.0).toLong()
      val buffer = ByteBuffer.allocateDirect(4 * 1024 * 1024)
      val info = MediaCodec.BufferInfo()

      for ((inTrack, outTrack) in mapped) {
        extractor.selectTrack(inTrack)
        extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
        while (true) {
          buffer.clear()
          val size = extractor.readSampleData(buffer, 0)
          if (size < 0) break
          val ts = extractor.sampleTime
          if (ts > endUs) break
          // 时间戳重基到 0：Broker 合并时按分片顺序拼接，分片内部必须从 0 开始
          info.set(0, size, (ts - startUs).coerceAtLeast(0L), extractor.sampleFlags)
          muxer.writeSampleData(outTrack, buffer, info)
          if (!extractor.advance()) break
        }
        extractor.unselectTrack(inTrack)
      }

      muxer.stop()
      muxer.release()
      return dst.length() > 0
    } catch (e: Exception) {
      return false
    } finally {
      extractor.release()
    }
  }
}
