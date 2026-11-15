// 迁移自 apps/shared/constants.js
export const JOB_ST: Record<string, string> = {
  pending: '待调度',
  leased: '已派发',
  fetching: '取源中',
  running: '转码中',
  uploading: '回传中',
  merging: '合成中',
  queued: '排队中',
  done: '完成',
  failed: '失败',
}

export const VM_ST: Record<string, string> = {
  queued: '排队中',
  provisioning: '启动中',
  running: '运行中',
  unreachable: '失联',
  stopping: '停机中',
  stopped: '已停机',
  failed: '失败',
}

export const LEDGER_KIND: Record<string, string> = {
  hold: '预扣',
  settle: '结算',
  refund: '退还',
  earn: '收益',
  recharge: '充值',
}
