package store

import (
	"path/filepath"
	"testing"
	"time"
)

func TestGatewaySpendPersistsAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "t.db")
	st, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	today := DayKey(time.Now())
	yesterday := DayKey(time.Now().AddDate(0, 0, -1))
	if err := st.AddGatewaySpend("k1", today, 0.25); err != nil {
		t.Fatal(err)
	}
	if err := st.AddGatewaySpend("k1", today, 0.10); err != nil {
		t.Fatal(err)
	}
	if err := st.AddGatewaySpend("k1", yesterday, 100); err != nil {
		t.Fatal(err)
	}
	if got, err := st.GatewaySpendToday("k1"); err != nil || got != 0.35 {
		t.Fatalf("today = %.4f (%v), want 0.35", got, err)
	}
	if got, err := st.GatewaySpendAllToday(); err != nil || got != 0.35 {
		t.Fatalf("all today = %.4f (%v), want 0.35", got, err)
	}
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}

	st2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer st2.Close()
	if got, err := st2.GatewaySpendToday("k1"); err != nil || got != 0.35 {
		t.Fatalf("after restart today = %.4f (%v), want 0.35 on disk", got, err)
	}
}

func TestGatewayUsageSummary(t *testing.T) {
	st, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.CreateUpstream(&Upstream{
		ID: "u1", OwnerID: "o1", Name: "官方供给", BaseURL: "https://api.deepseek.com",
		Models: []string{"m1"}, Price: 1, MaxContext: 32768, Caps: []string{"chat"},
		Enabled: true, CreatedAt: time.Now().Unix(),
	}); err != nil {
		t.Fatal(err)
	}
	ts := time.Now().Unix()
	for i := 0; i < 3; i++ {
		if err := st.AddGatewayUsage(&GatewayUsage{
			ID: "g" + string(rune('a'+i)), TS: ts, ReqID: "r1", KeyID: "k1", UserID: "buyer",
			UpstreamID: "u1", Model: "m1", Prompt: 100, Completion: 50, Cost: 0.5, OK: true,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := st.AddGatewayUsage(&GatewayUsage{
		ID: "gf", TS: ts, ReqID: "r2", KeyID: "k1", UserID: "buyer",
		UpstreamID: "u1", Model: "m1", Cost: 0, OK: false,
	}); err != nil {
		t.Fatal(err)
	}
	byUp, byModel, err := st.GatewayUsageSummary(7)
	if err != nil {
		t.Fatal(err)
	}
	if len(byUp) != 1 || byUp[0].Name != "官方供给" || byUp[0].Requests != 4 ||
		byUp[0].Failed != 1 || byUp[0].Cost != 1.5 ||
		byUp[0].Prompt != 300 || byUp[0].Completion != 150 {
		t.Fatalf("by_upstream = %+v", byUp)
	}
	if len(byModel) != 1 || byModel[0].Requests != 4 || byModel[0].Failed != 1 {
		t.Fatalf("by_model = %+v", byModel)
	}
}
