package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestComfyProbeModelsObjectInfo(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/system_stats":
			w.Write([]byte(`{"system":{"os":"nt"}}`))
		case "/object_info/CheckpointLoaderSimple":
			w.Write([]byte(`{"CheckpointLoaderSimple":{"input":{"required":{"ckpt_name":[["sd_xl_base_1.0.safetensors","flux/flux1-dev.safetensors","sd_xl_base_1.0.safetensors"]]}}}}`))
		case "/object_info/UNETLoader":
			w.Write([]byte(`{"UNETLoader":{"input":{"required":{"unet_name":[["wan2.1_t2v.safetensors"]]}}}}`))
		case "/object_info/LoraLoader":
			w.Write([]byte(`{"LoraLoader":{"input":{"required":{"lora_name":[["detail_tweaker.safetensors","anime_style.safetensors"]]}}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	m := comfyProbeModels(context.Background(), srv.URL)
	if m == nil || !m.Reachable {
		t.Fatalf("expected reachable ComfyModels, got %+v", m)
	}
	if len(m.Checkpoints) != 3 {
		t.Fatalf("expected 3 deduped checkpoints+unets, got %v", m.Checkpoints)
	}
	if len(m.LoRAs) != 2 || m.LoRAs[0] != "anime_style.safetensors" {
		t.Fatalf("unexpected loras: %v", m.LoRAs)
	}
}

func TestComfyProbeModelsFolderFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/system_stats":
			w.Write([]byte(`{}`))
		case "/models/checkpoints":
			w.Write([]byte(`["v1-5-pruned.safetensors"]`))
		case "/models/loras":
			w.Write([]byte(`["film_grain.safetensors"]`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	m := comfyProbeModels(context.Background(), srv.URL)
	if m == nil || !m.Reachable {
		t.Fatalf("expected reachable ComfyModels, got %+v", m)
	}
	if len(m.Checkpoints) != 1 || m.Checkpoints[0] != "v1-5-pruned.safetensors" {
		t.Fatalf("fallback checkpoints mismatch: %v", m.Checkpoints)
	}
	if len(m.LoRAs) != 1 || m.LoRAs[0] != "film_grain.safetensors" {
		t.Fatalf("fallback loras mismatch: %v", m.LoRAs)
	}
}

func TestComfyProbeModelsUnreachable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	m := comfyProbeModels(context.Background(), srv.URL)
	if m == nil || m.Reachable {
		t.Fatalf("expected unreachable ComfyModels, got %+v", m)
	}
}
