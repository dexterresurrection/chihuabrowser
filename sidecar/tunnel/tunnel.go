package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"chihuabrowser/tunnel/platform"
)

// Tunnel — запущенный xray с локальным SOCKS5.
type Tunnel struct {
	mu     sync.Mutex
	xray   string
	cmd    *exec.Cmd
	cur    *Server
	port   int
	logBuf *tail
	exited chan error
}

// New: xray — путь к исполняемому файлу.
func New(xray string) *Tunnel { return &Tunnel{xray: xray} }

// Config — конфиг xray: один вход SOCKS5 на loopback и один выход. DNS идёт через сервер: браузер отдаёт домены в SOCKS5.
func Config(outbound json.RawMessage, port int) ([]byte, error) {
	var o map[string]any
	if err := json.Unmarshal(outbound, &o); err != nil {
		return nil, err
	}
	o["tag"] = "proxy"
	cfg := map[string]any{
		"log": map[string]any{"loglevel": "warning"},
		"inbounds": []any{map[string]any{
			"tag": "socks", "listen": "127.0.0.1", "port": port, "protocol": "socks",
			"settings": map[string]any{"auth": "noauth", "udp": true},
			"sniffing": map[string]any{"enabled": true, "destOverride": []string{"http", "tls", "quic"}, "routeOnly": true},
		}},
		"outbounds": []any{o, map[string]any{"tag": "direct", "protocol": "freedom"}},
		"routing":   map[string]any{"domainStrategy": "AsIs", "rules": []any{}},
	}
	return json.Marshal(cfg)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// tail хранит конец журнала xray: при ошибке показать причину.
type tail struct {
	mu sync.Mutex
	b  []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.b = append(t.b, p...)
	if len(t.b) > 4096 {
		t.b = t.b[len(t.b)-4096:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.b))
}

// Start подключается к серверу, заменяя текущее подключение. Возвращает порт SOCKS5.
func (t *Tunnel) Start(ctx context.Context, s Server) (int, error) {
	return t.StartOn(ctx, s, 0)
}

// StartOn is Start on a given local port; 0 picks a free one.
func (t *Tunnel) StartOn(ctx context.Context, s Server, port int) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stopLocked()
	if port == 0 {
		var err error
		if port, err = freePort(); err != nil {
			return 0, err
		}
	}
	cfg, err := Config(s.Outbound, port)
	if err != nil {
		return 0, err
	}
	cmd := exec.Command(t.xray, "run", "-c", "stdin:")
	platform.Background(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return 0, err
	}
	log := &tail{}
	cmd.Stdout, cmd.Stderr = log, log
	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("xray не запустился: %w", err)
	}
	platform.BindToParent(cmd)
	_, _ = io.WriteString(stdin, string(cfg))
	_ = stdin.Close()
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()

	deadline := time.Now().Add(10 * time.Second)
	for {
		c, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), 300*time.Millisecond)
		if err == nil {
			_ = c.Close()
			break
		}
		select {
		case e := <-exited:
			return 0, fmt.Errorf("xray завершился: %v: %s", e, log.String())
		case <-ctx.Done():
			_ = cmd.Process.Kill()
			<-exited
			return 0, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			<-exited
			return 0, errors.New("xray не открыл порт за 10 секунд")
		}
	}
	t.cmd, t.exited, t.logBuf, t.port = cmd, exited, log, port
	cp := s
	t.cur = &cp
	return port, nil
}

// Status: подключённый сервер и порт; если xray упал, подключения нет.
func (t *Tunnel) Status() (*Server, int, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.cmd == nil {
		return nil, 0, ""
	}
	select {
	case e := <-t.exited:
		msg := fmt.Sprintf("xray завершился: %v: %s", e, t.logBuf.String())
		t.cmd, t.cur, t.port = nil, nil, 0
		return nil, 0, msg
	default:
	}
	return t.cur, t.port, ""
}

// Stop останавливает xray.
func (t *Tunnel) Stop() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.stopLocked()
}

func (t *Tunnel) stopLocked() {
	if t.cmd == nil {
		return
	}
	_ = t.cmd.Process.Kill()
	select {
	case <-t.exited:
	case <-time.After(3 * time.Second):
	}
	t.cmd, t.cur, t.port = nil, nil, 0
}
