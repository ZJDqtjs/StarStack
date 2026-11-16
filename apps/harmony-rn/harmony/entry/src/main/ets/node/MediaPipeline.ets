/**
 * 鸿蒙分片执行器 v0：AVDemuxer + AVMuxer 做无重编码切分（stream copy）。
 *
 * 与 Android 的 SegmentCutter 对齐：保证分片编码参数与源片一致，先把
 * 「领活 → 下载 → 切分 → 回传 → 校验 → 合并」跑通。按 Claim 的
 * vcodec/height/q 重编码（AVCodec）尚未实现；等媒体管线补齐后再替换本文件。
 */
import media from '@ohos.multimedia.media'
import fs from '@ohos.file.fs'

interface TrackPlan {
  inTrack: number
  outTrack: number
}

export async function cutSegment(
  srcPath: string,
  dstPath: string,
  startSec: number,
  durSec: number,
): Promise<boolean> {
  let demuxer: media.AVDemuxer | null = null
  let muxer: media.AVMuxer | null = null
  let outFile: fs.File | null = null
  try {
    demuxer = await media.createAVDemuxer()
    await demuxer.open(srcPath)

    outFile = fs.openSync(dstPath, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC)
    muxer = await media.createAVMuxer()
    await muxer.setFd(outFile.fd)

    const count: number = await demuxer.getTrackCount()
    const plans: TrackPlan[] = []
    for (let i = 0; i < count; i++) {
      const fmt: media.MediaDescription = await demuxer.getTrackFormat(i)
      const mime: string = fmt.mimeType ?? ''
      if (!mime.startsWith('video/') && !mime.startsWith('audio/')) continue
      const outTrack: number = await muxer.addTrack(fmt)
      plans.push({ inTrack: i, outTrack: outTrack })
    }
    if (plans.length === 0) return false

    await muxer.start()
    const startUs: number = Math.floor(startSec * 1000000)
    const endUs: number = Math.floor((startSec + durSec) * 1000000)

    for (let p = 0; p < plans.length; p++) {
      const plan = plans[p]
      await demuxer.selectTrack(plan.inTrack)
      await demuxer.seekToTime(Math.floor(startUs / 1000), media.SeekMode.SEEK_PREVIOUS_SYNC)
      while (true) {
        const buf = new ArrayBuffer(4 * 1024 * 1024)
        let info: media.AVCodecBufferInfo
        try {
          info = await demuxer.readSample(buf)
        } catch (e) {
          break
        }
        if (info.size <= 0) break
        if (info.presentationTimeUs > endUs) break
        const stamp: media.AVCodecBufferInfo = {
          offset: 0,
          size: info.size,
          presentationTimeUs: Math.max(0, info.presentationTimeUs - startUs),
          flags: info.flags,
        }
        await muxer.writeSample(plan.outTrack, buf.slice(0, info.size), stamp)
      }
      try {
        await demuxer.unselectTrack(plan.inTrack)
      } catch (e) {
        // 某些 SDK 版本没有 unselectTrack；下一轮 selectTrack 会替换选择
      }
    }

    await muxer.stop()
    return true
  } catch (e) {
    return false
  } finally {
    try {
      if (muxer) await muxer.release()
    } catch (e) {
    }
    try {
      if (demuxer) await demuxer.release()
    } catch (e) {
    }
    try {
      if (outFile) fs.closeSync(outFile)
    } catch (e) {
    }
  }
}
