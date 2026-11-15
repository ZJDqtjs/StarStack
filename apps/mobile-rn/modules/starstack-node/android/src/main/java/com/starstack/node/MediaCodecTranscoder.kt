package com.starstack.node

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * 真正的分片转码：解码 → 硬件编码 → 重新封装。
 *
 * 与桌面 libx264 的差异是刻意的：手机只有 MediaCodec 硬编，参数由硬件决定
 * （没有 CRF，只有码率），所以 Claim 里的 `q` 被换算成目标码率近似，
 * `height` 用于等比缩放。Broker 侧对这些分片走"容器统一 + 失败重编码"兜底。
 *
 * 全程走 Surface：解码器输出直接接到编码器输入，不经过 ByteBuffer 拷贝。
 * 音频不重编码，从源片按区间 stream copy 进新容器。
 */
object MediaCodecTranscoder {

  private const val TIMEOUT_US = 10_000L
  private const val MAX_IDLE_ROUNDS = 400

  data class Result(val ok: Boolean, val message: String)

  fun transcode(
    src: File,
    dst: File,
    startSec: Double,
    durSec: Double,
    targetHeight: Int,
    q: Int,
    vcodec: String
  ): Result {
    val startUs = (startSec * 1_000_000.0).toLong()
    val endUs = ((startSec + durSec) * 1_000_000.0).toLong()

    var extractor: MediaExtractor? = null
    var decoder: MediaCodec? = null
    var encoder: MediaCodec? = null
    var muxer: MediaMuxer? = null

    try {
      extractor = MediaExtractor().apply { setDataSource(src.absolutePath) }

      var videoTrack = -1
      var audioTrack = -1
      for (i in 0 until extractor.trackCount) {
        val mime = extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("video/") && videoTrack < 0) videoTrack = i
        if (mime.startsWith("audio/") && audioTrack < 0) audioTrack = i
      }
      if (videoTrack < 0) return Result(false, "源片没有视频轨")

      val srcFormat = extractor.getTrackFormat(videoTrack)
      val srcW = srcFormat.getInteger(MediaFormat.KEY_WIDTH)
      val srcH = srcFormat.getInteger(MediaFormat.KEY_HEIGHT)
      val srcMime = srcFormat.getString(MediaFormat.KEY_MIME) ?: "video/avc"
      var fps = 30
      if (srcFormat.containsKey(MediaFormat.KEY_FRAME_RATE)) {
        fps = srcFormat.getInteger(MediaFormat.KEY_FRAME_RATE).coerceIn(1, 60)
      }

      // 等比缩放到目标高度；宽高必须偶数，否则编码器直接拒绝
      val (outW, outH) = scaleTo(srcW, srcH, targetHeight)
      val outMime = if (srcMime.contains("265") || srcMime.contains("hevc")) {
        MediaFormat.MIMETYPE_VIDEO_HEVC
      } else {
        MediaFormat.MIMETYPE_VIDEO_AVC
      }

      muxer = MediaMuxer(dst.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      // 音频轨必须先 add（muxer.start 之后不能再加轨），视频轨等编码器协商出格式再加
      val audioOutTrack = if (audioTrack >= 0) {
        muxer.addTrack(extractor.getTrackFormat(audioTrack)).also { extractor.unselectTrack(audioTrack) }
      } else {
        -1
      }

      val bitrate = estimateBitrate(outW, outH, fps, q)

      encoder = MediaCodec.createEncoderByType(outMime)
      val encFormat = MediaFormat.createVideoFormat(outMime, outW, outH).apply {
        setInteger(
          MediaFormat.KEY_COLOR_FORMAT,
          MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface
        )
        setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
        setInteger(MediaFormat.KEY_FRAME_RATE, fps)
        setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      }
      encoder.configure(encFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      val inputSurface = encoder.createInputSurface()

      decoder = MediaCodec.createDecoderByType(srcMime)
      decoder.configure(srcFormat, inputSurface, null, 0)

      extractor.selectTrack(videoTrack)
      extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      encoder.start()
      decoder.start()

      var videoOutTrack = -1
      var muxerStarted = false
      var inputDone = false
      var outputDone = false
      var idle = 0
      val info = MediaCodec.BufferInfo()

      while (!outputDone) {
        var progressed = false

        if (!inputDone) {
          val inIdx = decoder.dequeueInputBuffer(TIMEOUT_US)
          if (inIdx >= 0) {
            val buffer = decoder.getInputBuffer(inIdx)!!
            val size = extractor.readSampleData(buffer, 0)
            val pts = extractor.sampleTime
            if (size < 0 || pts > endUs) {
              decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              decoder.queueInputBuffer(inIdx, 0, size, pts, 0)
              extractor.advance()
            }
            progressed = true
          }
        }

        val decIdx = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
        if (decIdx >= 0) {
          val eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
          // 渲染到编码器输入 Surface；EOS 帧不渲染
          decoder.releaseOutputBuffer(decIdx, !eos)
          progressed = true
        }

        val encIdx = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
        when {
          encIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            if (!muxerStarted) {
              videoOutTrack = muxer.addTrack(encoder.outputFormat)
              muxer.start()
              muxerStarted = true
            }
            progressed = true
          }
          encIdx >= 0 -> {
            val eos = (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0
            if (info.size > 0 && muxerStarted && videoOutTrack >= 0) {
              val buf = encoder.getOutputBuffer(encIdx)!!
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              // 分片内部时间戳从 0 开始，Broker 按顺序拼接
              info.presentationTimeUs = (info.presentationTimeUs - startUs).coerceAtLeast(0L)
              muxer.writeSampleData(videoOutTrack, buf, info)
            }
            encoder.releaseOutputBuffer(encIdx, false)
            if (eos) outputDone = true
            progressed = true
          }
        }

        if (!progressed) {
          idle++
          if (idle > MAX_IDLE_ROUNDS) return Result(false, "编码器长时间没有输出（idle 超限）")
        } else {
          idle = 0
        }
      }

      if (!muxerStarted) return Result(false, "编码器没有产出可用格式")

      // 音频：另开一个 extractor 走 stream copy，不重编码
      if (audioTrack >= 0 && audioOutTrack >= 0) {
        copyAudio(src, startUs, endUs, muxer, audioOutTrack)
      }

      muxer.stop()
      muxer.release()
      muxer = null
      return Result(true, "ok ${outW}x$outH @${bitrate / 1000}kbps")
    } catch (e: Exception) {
      return Result(false, e.message ?: "转码异常")
    } finally {
      runCatching { decoder?.stop() }
      runCatching { decoder?.release() }
      runCatching { encoder?.stop() }
      runCatching { encoder?.release() }
      runCatching { muxer?.release() }
      runCatching { extractor?.release() }
    }
  }

  /** 等比缩放到目标高度；targetHeight 为 0 或大于源高时不放大。 */
  private fun scaleTo(srcW: Int, srcH: Int, targetHeight: Int): Pair<Int, Int> {
    if (targetHeight <= 0 || targetHeight >= srcH) {
      return even(srcW) to even(srcH)
    }
    val ratio = targetHeight.toDouble() / srcH
    return even((srcW * ratio).toInt()) to even(targetHeight)
  }

  private fun even(v: Int) = if (v % 2 == 0) v else v - 1

  /**
   * Android 没有 CRF，把 ffmpeg 的 q 换算成「每像素每帧比特数」再乘分辨率：
   * q 越小画质越高、码率越大。系数是经验值，只保证量级合理。
   */
  private fun estimateBitrate(w: Int, h: Int, fps: Int, q: Int): Int {
    val bpp = when {
      q <= 18 -> 0.20
      q <= 23 -> 0.14
      q <= 28 -> 0.09
      q <= 33 -> 0.06
      else -> 0.04
    }
    val raw = w.toDouble() * h * fps * bpp
    return raw.toInt().coerceIn(400_000, 20_000_000)
  }

  private fun copyAudio(
    src: File,
    startUs: Long,
    endUs: Long,
    muxer: MediaMuxer,
    outTrack: Int
  ) {
    val ex = MediaExtractor()
    try {
      ex.setDataSource(src.absolutePath)
      var track = -1
      for (i in 0 until ex.trackCount) {
        val mime = ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME) ?: continue
        if (mime.startsWith("audio/")) {
          track = i
          break
        }
      }
      if (track < 0) return
      ex.selectTrack(track)
      ex.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
      val buf = ByteBuffer.allocateDirect(512 * 1024)
      val info = MediaCodec.BufferInfo()
      while (true) {
        buf.clear()
        val size = ex.readSampleData(buf, 0)
        if (size < 0) break
        val pts = ex.sampleTime
        if (pts > endUs) break
        info.set(0, size, (pts - startUs).coerceAtLeast(0L), ex.sampleFlags)
        muxer.writeSampleData(outTrack, buf, info)
        if (!ex.advance()) break
      }
    } finally {
      runCatching { ex.release() }
    }
  }
}
