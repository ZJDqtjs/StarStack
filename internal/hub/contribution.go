package hub

import (
	"log"
	"net/http"
	"time"

	"starstack/internal/store"
)

// Contribution is the platform's only definition of "贡献".
//
//   - A contribution is verified work that has actually been paid out. Nothing
//     that is online, idle, advertised or merely promised counts: task slices
//     must pass the SHA-256 double check, VM rentals must have been settled.
//   - "节点贡献" is the device view: one node's earned points and billed
//     seconds, split by market so video seconds and VM runtime seconds are
//     never added into one number.
//   - "卖家贡献" is the account view: the sum of every Earn row of that user.
//     A seller is not a separate entity, it is the owner of the nodes (plus the
//     owner of model upstreams, which have no node at all).
//   - The ledger is the single source of truth. nodes.earned* is a denormalised
//     per-device cache of the same Earn rows, never a second accounting system.
//
// Split: task slices pay 100% to the node owner, VM rentals pay 90% (10%
// platform fee), model upstreams pay 90% to the provider. Those rates stay in
// their own markets; this file only records what was actually paid.
const (
	ContribTask  = "task"  // 转码 / 渲染 / 编译分片
	ContribVM    = "vm"    // 云主机租用
	ContribModel = "model" // 模型市场上游
)

type Contribution struct {
	OwnerID string
	NodeID  string // empty for earnings that are not tied to a machine
	JobID   string
	Source  string
	Seconds float64 // video/wall seconds for tasks, runtime seconds for VMs
	Amount  float64
	Note    string
}

// recordContribution is the single writer of seller earnings. Every market
// calls it, so the ledger row and the node's contribution cache can no longer
// drift apart (and every Earn row carries its source).
func (s *Server) recordContribution(c Contribution) {
	if c.OwnerID == "" || c.Amount <= 0 {
		return
	}
	if bal, err := s.st.AddCredits(c.OwnerID, c.Amount); err != nil {
		log.Printf("contribution credit %s: %v", c.OwnerID, err)
	} else {
		if err := s.st.Ledger(&store.Entry{
			TS: time.Now().Unix(), Kind: store.Earn, UserID: c.OwnerID,
			NodeID: c.NodeID, JobID: c.JobID, Amount: c.Amount, Balance: bal,
			Note: c.Note, Source: c.Source,
		}); err != nil {
			log.Printf("contribution ledger: %v", err)
		}
	}
	if c.NodeID != "" {
		if err := s.st.AddNodeContribution(c.NodeID, c.Source, c.Seconds, c.Amount); err != nil {
			log.Printf("contribution node %s: %v", c.NodeID, err)
		}
	}
}

// applyContributionLocked mirrors the DB write into the in-memory worker view
// that /api/state serves. Callers already hold s.mu.
func applyContributionLocked(wd *Worker, c Contribution) {
	if wd == nil {
		return
	}
	wd.Earned = round4(wd.Earned + c.Amount)
	wd.Billed += c.Seconds
	if c.Source == ContribVM {
		wd.EarnedVM = round4(wd.EarnedVM + c.Amount)
		wd.BilledVMSec += c.Seconds
	} else {
		wd.EarnedTask = round4(wd.EarnedTask + c.Amount)
		wd.BilledTaskSec += c.Seconds
	}
}

// handleContribution answers "what did I contribute, and where did the points
// come from?" in two layers, so the console never has to add up a page of
// ledger rows (which used to under-report anything older than 100 entries).
func (s *Server) handleContribution(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	bySource, err := s.st.EarningsBySource(u.ID)
	if err != nil {
		http.Error(w, jsonErr("读取贡献账目失败"), 500)
		return
	}
	nodes, err := s.st.NodesByOwner(u.ID)
	if err != nil {
		http.Error(w, jsonErr("读取节点失败"), 500)
		return
	}
	var sellerTotal, nodeTotal float64
	for _, v := range bySource {
		sellerTotal += v
	}
	// A device fingerprint shared by several rows means the account has stale
	// duplicates from before the one-device-one-node rule. Flag them instead of
	// silently merging rows that may carry their own contribution history.
	seen := map[string]int{}
	for _, n := range nodes {
		if n.DeviceID != "" {
			seen[n.DeviceID]++
		}
	}
	views := make([]map[string]any, 0, len(nodes))
	s.mu.Lock()
	for _, n := range nodes {
		wd := s.workers[n.ID]
		views = append(views, map[string]any{
			"id": n.ID, "name": n.Name, "device_id": n.DeviceID,
			"online": wd != nil && wd.online(),
			"earned": round4(n.Earned), "billed_sec": round4(n.SecondsBilled),
			"earned_task": round4(n.EarnedTask), "earned_vm": round4(n.EarnedVM),
			"billed_task_sec": round4(n.BilledTaskSec), "billed_vm_sec": round4(n.BilledVMSec),
			"duplicate": n.DeviceID != "" && seen[n.DeviceID] > 1,
		})
		nodeTotal += n.Earned
	}
	s.mu.Unlock()
	writeJSON(w, map[string]any{
		"definition": map[string]any{
			"seller": "账户维度：账本中该用户全部 Earn 流水之和",
			"node":   "设备维度：单台节点已结算的任务/云主机收益与计费时长",
			"bridge": "卖家贡献 = Σ 当前名下节点贡献 + 非节点收益（模型上游、已删除节点的历史收益、旧账口径差）",
			"rule":   "只有哈希校验通过的任务分片和已结算的云主机租用才计入贡献，在线/挂机不产生贡献",
		},
		"seller": map[string]any{
			"total_earned": round4(sellerTotal),
			"by_source": map[string]any{
				ContribTask:  round4(bySource[ContribTask]),
				ContribVM:    round4(bySource[ContribVM]),
				ContribModel: round4(bySource[ContribModel]),
			},
			"source_label": map[string]any{
				ContribTask:  "任务算力（转码/渲染/编译，节点 owner 得 100%）",
				ContribVM:    "云主机租用（卖方得 90%，平台 10%）",
				ContribModel: "模型市场上游（provider 得 90%，无节点）",
			},
			"node_count": len(nodes),
		},
		"node_total_earned": round4(nodeTotal),
		"other_earned":      round4(sellerTotal - nodeTotal),
		"nodes":             views,
	})
}
