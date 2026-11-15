package com.starstack.node

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * 前台 Service：算力贡献的宿主进程。
 * 选 Service 而不是靠 JS 定时器，是因为 Android 会挂起后台的 RN JS 上下文；
 * 常驻任务必须在原生侧，通知栏也是系统对长时任务的硬性要求。
 */
class NodeService : Service() {

  companion object {
    const val ACTION_START = "com.starstack.node.action.START"
    const val ACTION_STOP = "com.starstack.node.action.STOP"
    const val EXTRA_BASE = "base"
    const val EXTRA_CODE = "code"
    const val EXTRA_NODE_ID = "node_id"
    const val EXTRA_SLOTS = "slots"
    const val EXTRA_PRICE = "price"

    private const val CHANNEL_ID = "starstack-node"
    private const val NOTIFICATION_ID = 4711

    /** Expo Module 订阅状态推送用；Service 与 Module 生命周期不同，用静态引用桥接。 */
    @Volatile
    var listener: ((Map<String, Any>) -> Unit)? = null

    @Volatile
    private var state: MutableMap<String, Any> = initialState()

    private fun initialState(): MutableMap<String, Any> = mutableMapOf(
      "running" to false,
      "nodeId" to "",
      "phase" to "idle",
      "segId" to "",
      "pct" to 0,
      "lastError" to "",
      "served" to 0,
      "earned" to 0.0,
      "encoder" to ""
    )

    fun snapshot(): Map<String, Any> = HashMap(state)

    fun update(patch: Map<String, Any>) {
      state.putAll(patch)
      listener?.invoke(HashMap(state))
    }

    fun reset() {
      state = initialState()
      listener?.invoke(HashMap(state))
    }
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var runner: NodeRunner? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    ensureChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val base = intent.getStringExtra(EXTRA_BASE).orEmpty()
        val code = intent.getStringExtra(EXTRA_CODE).orEmpty()
        val nodeId = intent.getStringExtra(EXTRA_NODE_ID).orEmpty()
        val slots = intent.getIntExtra(EXTRA_SLOTS, 1)
        val price = intent.getDoubleExtra(EXTRA_PRICE, 0.8)

        startInForeground("正在注册节点…")
        runner?.stop()
        val r = NodeRunner(
          ctx = applicationContext,
          baseUrl = base,
          launchCode = code,
          nodeIdHint = nodeId,
          slots = slots,
          price = price,
          onPhase = ::onPhase
        )
        runner = r
        update(mapOf("running" to true, "phase" to "registering", "lastError" to ""))
        r.start(scope)
      }

      ACTION_STOP -> {
        runner?.stop()
        runner = null
        reset()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    runner?.stop()
    runner = null
    scope.cancel()
    super.onDestroy()
  }

  private fun onPhase(phase: String, detail: Map<String, Any>) {
    update(mapOf("phase" to phase) + detail)
    val text = when (phase) {
      "polling" -> "等待派单"
      "fetching" -> "下载源片"
      "transcoding" -> "切分/转码中"
      "uploading" -> "回传产物"
      "error" -> "异常：" + (detail["lastError"] as? String ?: "未知")
      else -> "已启动"
    }
    runCatching { notify(text) }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(NotificationManager::class.java)
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "算力节点", NotificationManager.IMPORTANCE_LOW).apply {
      description = "本机贡献闲置算力时显示运行状态"
      setShowBadge(false)
    }
    mgr.createNotificationChannel(channel)
  }

  private fun buildNotification(text: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("星栈算力 · 正在贡献")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .build()
  }

  private fun startInForeground(text: String) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        buildNotification(text),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      )
    } else {
      startForeground(NOTIFICATION_ID, buildNotification(text))
    }
  }

  private fun notify(text: String) {
    val mgr = getSystemService(NotificationManager::class.java)
    mgr.notify(NOTIFICATION_ID, buildNotification(text))
  }
}
