package com.starstack.node

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo Module：JS 侧唯一的入口。
 * 只暴露 start / stop / status 三个方法 + onNodeStatus 事件，
 * 计算与网络都在 NodeService 里，JS 不参与常驻循环。
 */
class NodeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("StarStackNode")

    Events("onNodeStatus")

    AsyncFunction("start") { baseUrl: String, launchCode: String, nodeId: String, slots: Int, price: Double ->
      val ctx = appContext.reactContext ?: throw IllegalStateException("缺少 Android context")
      val intent = Intent(ctx, NodeService::class.java).apply {
        action = NodeService.ACTION_START
        putExtra(NodeService.EXTRA_BASE, baseUrl)
        putExtra(NodeService.EXTRA_CODE, launchCode)
        putExtra(NodeService.EXTRA_NODE_ID, nodeId)
        putExtra(NodeService.EXTRA_SLOTS, slots)
        putExtra(NodeService.EXTRA_PRICE, price)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      Unit
    }

    AsyncFunction("stop") {
      val ctx = appContext.reactContext ?: return@AsyncFunction
      ctx.startService(Intent(ctx, NodeService::class.java).apply { action = NodeService.ACTION_STOP })
      Unit
    }

    AsyncFunction("status") {
      NodeService.snapshot()
    }

    OnStartObserving {
      NodeService.listener = { status -> sendEvent("onNodeStatus", status) }
    }

    OnStopObserving {
      NodeService.listener = null
    }
  }
}
