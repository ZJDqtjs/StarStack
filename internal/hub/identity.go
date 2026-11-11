package hub

import (
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"starstack/internal/store"
)

// A device id becomes a file name, a URL segment and a database key, so accept
// only the same shape the desktop launcher validates before trusting it.
var deviceIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// resolveNodeIdentity enforces "one account, one machine, one node" at the
// only place a node can be born: the hello handler.
//
// An agent that reports no fingerprint is an old build; it keeps the old
// behaviour (its id is whatever it sent) so upgrading the broker cannot break
// nodes that are already deployed.
//
// Otherwise the broker picks the node id itself: it reuses the account's
// existing node for that device, adopts an unclaimed one, or mints a stable
// dev-<fingerprint> id. Repeatedly clicking "download node package" on the same
// computer therefore keeps landing on the same node, with its price, owner,
// reputation and contribution history intact.
func (s *Server) resolveNodeIdentity(info *NodeInfo, ticketOwner string) (string, string) {
	dev := strings.TrimSpace(info.DeviceID)
	if !deviceIDRE.MatchString(dev) {
		return info.ID, ""
	}
	if s.st.IsRetiredNode(info.ID) {
		// A freshly minted ticket means the owner downloaded a new package and
		// deliberately wants this machine back. It gets a new id, while the old
		// agent (still holding the retired id and credential) stays blocked.
		if ticketOwner == "" {
			return "", "这个节点已被所有者删除。请在这台机器上重新下载节点包（旧的节点凭据已失效），或关闭节点程序。"
		}
		return rejoinID(dev), ""
	}
	owner := ticketOwner
	if owner == "" {
		if o, err := s.st.NodeOwner(info.ID); err == nil {
			owner = o
		}
	}
	id, conflict, err := s.st.NodeForDevice(owner, dev, info.ID)
	if err != nil {
		log.Printf("device lookup %s: %v", dev, err)
		return info.ID, ""
	}
	if conflict {
		return "", "这台设备已绑定在其它账户的节点上；请先用原账户删除该节点，或继续使用原来的账户。"
	}
	if id != "" {
		if id != info.ID {
			log.Printf("device %s already has node %s; reused instead of %s", dev, id, info.ID)
		}
		return id, ""
	}
	// A deleted device is allowed to join again, but under a fresh id so its
	// old tombstone still blocks the stale agent that may still be running.
	if s.st.IsRetiredNode(dev) {
		return rejoinID(dev), ""
	}
	return dev, ""
}

// rejoinID mints a new, still-valid id for a device whose previous node was
// deleted. Keeping the fingerprint prefix makes the origin obvious in the logs.
func rejoinID(dev string) string {
	fresh := dev + "-r" + strconv.FormatInt(time.Now().UnixNano(), 36)
	if !deviceIDRE.MatchString(fresh) {
		fresh = dev + "-r"
	}
	return fresh
}

// deleteNode is DELETE /api/nodes/{id}. It removes the device from the owner's
// pool, not the history: ledger rows, segments and communication logs stay as
// evidence of work that was already paid for. A tombstone stops the agent's
// cached id from resurrecting the node on its next heartbeat.
func (s *Server) deleteNode(w http.ResponseWriter, r *http.Request, u *store.User, id string) {
	nodes, err := s.st.NodesByOwner(u.ID)
	if err != nil {
		http.Error(w, jsonErr("读取节点失败"), 500)
		return
	}
	deviceID := ""
	found := false
	for _, n := range nodes {
		if n.ID == id {
			deviceID, found = n.DeviceID, true
			break
		}
	}
	if !found {
		http.NotFound(w, r)
		return
	}
	s.mu.Lock()
	active := 0
	if wd := s.workers[id]; wd != nil {
		active = s.activeLocked(wd)
	}
	busyVM := false
	for _, inst := range s.vms {
		if inst.NodeID == id && (inst.Status == "queued" || inst.Status == "provisioning" || inst.Status == "running") {
			busyVM = true
			break
		}
	}
	s.mu.Unlock()
	if active > 0 {
		http.Error(w, jsonErr("这台机器还有 "+strconv.Itoa(active)+" 个分片在执行，等任务结束再删除"), http.StatusConflict)
		return
	}
	if busyVM {
		http.Error(w, jsonErr("这台机器上的云主机还在运行，请先停机再删除节点"), http.StatusConflict)
		return
	}
	if err := s.st.RetireNode(id, u.ID, deviceID); err != nil {
		log.Printf("retire node %s: %v", id, err)
		http.Error(w, jsonErr("删除失败"), 500)
		return
	}
	s.mu.Lock()
	delete(s.workers, id)
	for code, nid := range s.codes {
		if nid == id {
			delete(s.codes, code)
		}
	}
	for oid, o := range s.voffers {
		if o.NodeID == id {
			delete(s.voffers, oid)
		}
	}
	s.mu.Unlock()
	log.Printf("user %s deleted node %s (device %s)", u.Name, id, deviceID)
	writeJSON(w, map[string]any{"ok": true, "id": id})
}
