package tunnel

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

const uuid = "11111111-2222-3333-4444-555555555555"

// Настоящий xray из CHIHUA_TEST_XRAY проверяет, что конфиг принимается и трафик идёт.
func xray(t *testing.T) string {
	t.Helper()
	p := os.Getenv("CHIHUA_TEST_XRAY")
	if p == "" {
		t.Skip("нет CHIHUA_TEST_XRAY")
	}
	return p
}

var sampleLinks = map[string]string{
	"VLESS Reality": "vless://" + uuid + "@example.com:443?type=tcp&security=reality&pbk=" + strings.Repeat("A", 43) + "&sid=abcd&fp=chrome&sni=www.example.org&flow=xtls-rprx-vision#Reality",
	"VLESS TLS WS":  "vless://" + uuid + "@example.com:443?type=ws&security=tls&path=%2Fws&host=cdn.example.org&sni=cdn.example.org#WS",
	"VLESS gRPC":    "vless://" + uuid + "@example.com:443?type=grpc&security=tls&serviceName=svc&sni=example.org#gRPC",
	"VLESS XHTTP":   "vless://" + uuid + "@example.com:443?type=xhttp&security=tls&path=%2Fx&mode=auto&sni=example.org#XHTTP",
	"VLESS HTTPUp":  "vless://" + uuid + "@example.com:443?type=httpupgrade&security=tls&path=%2Fu&host=a.example#HU",
	"Trojan":        "trojan://secret@example.com:443?sni=example.org#Trojan",
	"Shadowsocks":   "ss://" + base64.RawStdEncoding.EncodeToString([]byte("aes-256-gcm:pw")) + "@example.com:8388#SS",
	"Shadowsocks2":  "ss://aes-128-gcm:pw@example.com:8388#SS2",
	"VMess": "vmess://" + base64.StdEncoding.EncodeToString(mustJSON(map[string]any{
		"v": "2", "ps": "VM", "add": "example.com", "port": "443", "id": uuid, "aid": "0", "scy": "auto", "net": "ws", "type": "none", "host": "a.example", "path": "/w", "tls": "tls", "sni": "a.example",
	})),
	"Hysteria2": "hysteria2://pw@example.com:443?sni=example.org#HY2",
	"SOCKS5":    "socks5://user:pass@example.com:1080#S",
	"SOCKS5nop": "socks5://example.com:1080",
	"HTTP":      "http://user:pass@example.com:8080",
	"HTTPS":     "https://user:pass@example.com:8443",
}

func TestEveryLinkBecomesConfigXrayAccepts(t *testing.T) {
	bin := xray(t)
	for name, link := range sampleLinks {
		t.Run(name, func(t *testing.T) {
			s, err := ParseLink(link)
			if err != nil {
				t.Fatal(err)
			}
			cfg, err := Config(s.Outbound, 10808)
			if err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(bin, "run", "-test", "-c", "stdin:")
			cmd.Stdin = strings.NewReader(string(cfg))
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("xray отверг конфиг: %v\n%s\n%s", err, out, cfg)
			}
		})
	}
}

func TestSubscriptionFormats(t *testing.T) {
	text := "vless://" + uuid + "@a.example:443?security=tls#Один\n\nnot a link\ntrojan://p@b.example:443#Два\nwireguard://x@c.example:51820#Нет\n"
	for _, in := range []string{text, base64.StdEncoding.EncodeToString([]byte(text)), base64.URLEncoding.EncodeToString([]byte(text))} {
		got := ParseSubscription(in)
		if len(got) != 2 || got[0].Name != "Один" || got[1].Name != "Два" || got[0].ID == got[1].ID {
			t.Fatalf("%+v", got)
		}
	}
	if got := ParseSubscription("мусор"); len(got) != 0 {
		t.Fatalf("%+v", got)
	}
}

func TestBadLinks(t *testing.T) {
	for _, l := range []string{"vless://x@host", "vless://x@host:99999", "trojan://p@:443", "ss://bad", "vmess://!!!", "vless://x@a.example:1?type=wat", "vless://x@a.example:1?security=wat"} {
		if _, err := ParseLink(l); err == nil {
			t.Errorf("принято: %s", l)
		}
	}
}

// Настоящий трафик: браузерный SOCKS5 → наш xray → xray-сервер VLESS → сайт.
func TestTrafficThroughTunnel(t *testing.T) {
	bin := xray(t)
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "привет через туннель")
	}))
	defer site.Close()

	l, _ := net.Listen("tcp", "127.0.0.1:0")
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	srvCfg, _ := json.Marshal(map[string]any{
		"log": map[string]any{"loglevel": "warning"},
		"inbounds": []any{map[string]any{"listen": "127.0.0.1", "port": port, "protocol": "vless",
			"settings": map[string]any{"clients": []any{map[string]any{"id": uuid}}, "decryption": "none"}, "streamSettings": map[string]any{"network": "tcp"}}},
		"outbounds": []any{map[string]any{"protocol": "freedom", "settings": map[string]any{"finalRules": []any{map[string]any{"action": "allow"}}}}},
	})
	srv := exec.Command(bin, "run", "-c", "stdin:")
	srv.Stdin = strings.NewReader(string(srvCfg))
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = srv.Process.Kill(); _ = srv.Wait() }()
	time.Sleep(700 * time.Millisecond)

	s, err := ParseLink(fmt.Sprintf("vless://%s@127.0.0.1:%d?type=tcp&security=none#local", uuid, port))
	if err != nil {
		t.Fatal(err)
	}
	tun := New(bin)
	defer tun.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	socks, err := tun.Start(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	cur, p, _ := tun.Status()
	if cur == nil || p != socks || cur.Name != "local" {
		t.Fatalf("статус %+v %d", cur, p)
	}
	proxy, _ := url.Parse(fmt.Sprintf("socks5h://127.0.0.1:%d", socks))
	client := &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxy)}, Timeout: 15 * time.Second}
	resp, err := client.Get(site.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if string(body) != "привет через туннель" {
		t.Fatalf("%q", body)
	}

	// Смена сервера заменяет процесс, старый порт закрывается
	socks2, err := tun.Start(ctx, s)
	if err != nil {
		t.Fatal(err)
	}
	if socks2 == socks {
		if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", socks2), time.Second); err == nil {
			_ = c.Close()
		}
	}
	tun.Stop()
	if c, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", socks2), 500*time.Millisecond); err == nil {
		_ = c.Close()
		t.Fatal("после Stop порт ещё открыт")
	}
	if cur, _, _ := tun.Status(); cur != nil {
		t.Fatal("после Stop есть подключение")
	}
}

// Упавший xray должен быть виден как ошибка, а не как подключение.
func TestBrokenConfigReportsError(t *testing.T) {
	bin := xray(t)
	tun := New(bin)
	defer tun.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, err := tun.Start(ctx, Server{Outbound: json.RawMessage(`{"protocol":"нет такого"}`)})
	if err == nil {
		t.Fatal("плохой конфиг принят")
	}
}
