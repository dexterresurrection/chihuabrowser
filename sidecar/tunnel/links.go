// Package tunnel превращает ссылки подписки в конфиг xray и держит процесс xray: так браузер получает VLESS, Trojan и остальное,
// что сам не умеет, без системного VPN. Наружу виден только локальный SOCKS5.
package tunnel

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Server — один сервер из подписки.
type Server struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Protocol string          `json:"protocol"`
	Outbound json.RawMessage `json:"-"`
	Link     string          `json:"-"`
}

var errSkip = errors.New("этот тип ссылки браузеру недоступен")

// ParseSubscription разбирает текст подписки: base64 или ссылки построчно. Незнакомое пропускается, а не роняет всё.
func ParseSubscription(text string) []Server {
	text = strings.TrimSpace(text)
	if !strings.Contains(text, "://") {
		if dec, err := decodeB64(text); err == nil {
			text = string(dec)
		}
	}
	var out []Server
	seen := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(line, "://") {
			continue
		}
		s, err := ParseLink(line)
		if err != nil || seen[s.Name+string(s.Outbound)] {
			continue
		}
		seen[s.Name+string(s.Outbound)] = true
		s.ID = strconv.Itoa(len(out) + 1)
		out = append(out, s)
	}
	return out
}

func decodeB64(s string) ([]byte, error) {
	s = strings.TrimSpace(strings.NewReplacer("\n", "", "\r", "", "-", "+", "_", "/").Replace(s))
	s = strings.TrimRight(s, "=")
	return base64.RawStdEncoding.DecodeString(s)
}

// ParseLink разбирает одну ссылку.
func ParseLink(link string) (Server, error) {
	s, err := parseLink(link)
	s.Link = link
	return s, err
}

func parseLink(link string) (Server, error) {
	switch {
	case strings.HasPrefix(link, "vless://"):
		return parseVLESS(link)
	case strings.HasPrefix(link, "trojan://"):
		return parseTrojan(link)
	case strings.HasPrefix(link, "vmess://"):
		return parseVMess(link)
	case strings.HasPrefix(link, "ss://"):
		return parseSS(link)
	case strings.HasPrefix(link, "hysteria2://"), strings.HasPrefix(link, "hy2://"):
		return parseHy2(link)
	case strings.HasPrefix(link, "socks5://"), strings.HasPrefix(link, "socks://"), strings.HasPrefix(link, "http://"), strings.HasPrefix(link, "https://"):
		return parseProxy(link)
	}
	return Server{}, errSkip
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func hostPort(u *url.URL) (string, int, error) {
	host := u.Hostname()
	port, err := strconv.Atoi(u.Port())
	if host == "" || err != nil || port <= 0 || port > 65535 {
		return "", 0, fmt.Errorf("нет адреса сервера")
	}
	return host, port, nil
}

func name(u *url.URL, fallback string) string {
	if u.Fragment != "" {
		return u.Fragment
	}
	return fallback
}

// stream собирает streamSettings из параметров ссылки (те же имена, что в v2rayNG).
func stream(q url.Values, host string) (map[string]any, error) {
	network := q.Get("type")
	if network == "" {
		network = "tcp"
	}
	ss := map[string]any{"network": network}
	switch network {
	case "tcp", "raw":
		if q.Get("headerType") == "http" {
			req := map[string]any{"path": []string{firstOr(q.Get("path"), "/")}}
			if h := q.Get("host"); h != "" {
				req["headers"] = map[string]any{"Host": []string{h}}
			}
			ss["tcpSettings"] = map[string]any{"header": map[string]any{"type": "http", "request": req}}
		}
	case "ws":
		ws := map[string]any{"path": firstOr(q.Get("path"), "/")}
		if h := q.Get("host"); h != "" {
			ws["host"] = h
		}
		ss["wsSettings"] = ws
	case "grpc":
		ss["grpcSettings"] = map[string]any{"serviceName": q.Get("serviceName"), "multiMode": q.Get("mode") == "multi", "authority": q.Get("authority")}
	case "httpupgrade":
		ss["httpupgradeSettings"] = map[string]any{"path": firstOr(q.Get("path"), "/"), "host": q.Get("host")}
	case "xhttp", "splithttp":
		ss["network"] = "xhttp"
		x := map[string]any{"path": firstOr(q.Get("path"), "/"), "host": q.Get("host"), "mode": firstOr(q.Get("mode"), "auto")}
		if extra := q.Get("extra"); extra != "" {
			var e map[string]any
			if json.Unmarshal([]byte(extra), &e) == nil {
				x["extra"] = e
			}
		}
		ss["xhttpSettings"] = x
	case "kcp", "mkcp":
		ss["network"] = "kcp"
		ss["kcpSettings"] = map[string]any{"seed": q.Get("seed"), "header": map[string]any{"type": firstOr(q.Get("headerType"), "none")}}
	default:
		return nil, errSkip
	}
	sni := firstOr(q.Get("sni"), q.Get("peer"))
	alpn := []string{}
	if a := q.Get("alpn"); a != "" {
		alpn = strings.Split(a, ",")
	}
	switch q.Get("security") {
	case "", "none":
		ss["security"] = "none"
	case "tls":
		t := map[string]any{"serverName": firstOr(sni, firstOr(q.Get("host"), host)), "fingerprint": firstOr(q.Get("fp"), "chrome")}
		if len(alpn) > 0 {
			t["alpn"] = alpn
		}
		if q.Get("allowInsecure") == "1" || q.Get("insecure") == "1" {
			t["allowInsecure"] = true
		}
		ss["security"] = "tls"
		ss["tlsSettings"] = t
	case "reality":
		ss["security"] = "reality"
		ss["realitySettings"] = map[string]any{
			"serverName": firstOr(sni, host), "fingerprint": firstOr(q.Get("fp"), "chrome"), "publicKey": q.Get("pbk"),
			"shortId": q.Get("sid"), "spiderX": q.Get("spx"),
		}
	default:
		return nil, errSkip
	}
	return ss, nil
}

func firstOr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func parseVLESS(link string) (Server, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Server{}, err
	}
	host, port, err := hostPort(u)
	if err != nil {
		return Server{}, err
	}
	q := u.Query()
	ss, err := stream(q, host)
	if err != nil {
		return Server{}, err
	}
	user := map[string]any{"id": u.User.Username(), "encryption": firstOr(q.Get("encryption"), "none")}
	if f := q.Get("flow"); f != "" {
		user["flow"] = f
	}
	out := map[string]any{"protocol": "vless", "settings": map[string]any{"vnext": []any{map[string]any{"address": host, "port": port, "users": []any{user}}}}, "streamSettings": ss}
	return Server{Name: name(u, host), Protocol: "VLESS", Outbound: mustJSON(out)}, nil
}

func parseTrojan(link string) (Server, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Server{}, err
	}
	host, port, err := hostPort(u)
	if err != nil {
		return Server{}, err
	}
	q := u.Query()
	if q.Get("security") == "" {
		q.Set("security", "tls")
	}
	ss, err := stream(q, host)
	if err != nil {
		return Server{}, err
	}
	out := map[string]any{"protocol": "trojan", "settings": map[string]any{"servers": []any{map[string]any{"address": host, "port": port, "password": u.User.Username()}}}, "streamSettings": ss}
	return Server{Name: name(u, host), Protocol: "Trojan", Outbound: mustJSON(out)}, nil
}

func parseVMess(link string) (Server, error) {
	raw, err := decodeB64(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		return Server{}, err
	}
	var v struct {
		PS   string `json:"ps"`
		Add  string `json:"add"`
		Port any    `json:"port"`
		ID   string `json:"id"`
		Aid  any    `json:"aid"`
		Scy  string `json:"scy"`
		Net  string `json:"net"`
		Type string `json:"type"`
		Host string `json:"host"`
		Path string `json:"path"`
		TLS  string `json:"tls"`
		SNI  string `json:"sni"`
		ALPN string `json:"alpn"`
		FP   string `json:"fp"`
	}
	if err := json.Unmarshal(raw, &v); err != nil {
		return Server{}, err
	}
	port, _ := strconv.Atoi(fmt.Sprint(v.Port))
	if v.Add == "" || port <= 0 || v.ID == "" {
		return Server{}, fmt.Errorf("неполная ссылка vmess")
	}
	q := url.Values{}
	q.Set("type", firstOr(v.Net, "tcp"))
	q.Set("headerType", v.Type)
	q.Set("host", v.Host)
	q.Set("path", v.Path)
	q.Set("serviceName", v.Path)
	q.Set("security", v.TLS)
	q.Set("sni", v.SNI)
	q.Set("alpn", v.ALPN)
	q.Set("fp", v.FP)
	ss, err := stream(q, v.Add)
	if err != nil {
		return Server{}, err
	}
	user := map[string]any{"id": v.ID, "security": firstOr(v.Scy, "auto")}
	out := map[string]any{"protocol": "vmess", "settings": map[string]any{"vnext": []any{map[string]any{"address": v.Add, "port": port, "users": []any{user}}}}, "streamSettings": ss}
	return Server{Name: firstOr(v.PS, v.Add), Protocol: "VMess", Outbound: mustJSON(out)}, nil
}

func parseSS(link string) (Server, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Server{}, err
	}
	method, password := "", ""
	host, port := "", 0
	if u.User != nil && u.Port() != "" {
		if p, ok := u.User.Password(); ok {
			method, password = u.User.Username(), p
		} else if dec, err := decodeB64(u.User.Username()); err == nil {
			method, password, _ = strings.Cut(string(dec), ":")
		}
		host, port, err = hostPort(u)
		if err != nil {
			return Server{}, err
		}
	} else {
		// старый формат: ss://base64(method:pass@host:port)#name
		dec, err := decodeB64(strings.SplitN(strings.TrimPrefix(link, "ss://"), "#", 2)[0])
		if err != nil {
			return Server{}, err
		}
		cred, addr, ok := strings.Cut(string(dec), "@")
		if !ok {
			return Server{}, fmt.Errorf("неверная ссылка ss")
		}
		method, password, _ = strings.Cut(cred, ":")
		h, p, err := net.SplitHostPort(addr)
		if err != nil {
			return Server{}, err
		}
		host = h
		port, _ = strconv.Atoi(p)
	}
	if method == "" || password == "" || host == "" || port == 0 {
		return Server{}, fmt.Errorf("неполная ссылка ss")
	}
	out := map[string]any{"protocol": "shadowsocks", "settings": map[string]any{"servers": []any{map[string]any{"address": host, "port": port, "method": method, "password": password}}}}
	return Server{Name: name(u, host), Protocol: "Shadowsocks", Outbound: mustJSON(out)}, nil
}

func parseHy2(link string) (Server, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Server{}, err
	}
	host, port, err := hostPort(u)
	if err != nil {
		return Server{}, err
	}
	q := u.Query()
	auth := u.User.Username()
	if p, ok := u.User.Password(); ok {
		auth += ":" + p
	}
	tls := map[string]any{"serverName": firstOr(q.Get("sni"), host), "alpn": []string{"h3"}}
	if q.Get("insecure") == "1" {
		tls["allowInsecure"] = true
	}
	h := map[string]any{"version": 2, "auth": auth}
	ss := map[string]any{"network": "hysteria", "security": "tls", "tlsSettings": tls, "hysteriaSettings": h}
	if q.Get("obfs") == "salamander" {
		ss["finalmask"] = map[string]any{"udp": []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": q.Get("obfs-password")}}}}
	}
	out := map[string]any{"protocol": "hysteria", "settings": map[string]any{"version": 2, "address": host, "port": port}, "streamSettings": ss}
	return Server{Name: name(u, host), Protocol: "Hysteria2", Outbound: mustJSON(out)}, nil
}

// parseProxy: обычный прокси, в том числе с логином. Chromium не умеет SOCKS5 с паролем, а xray на входе в браузер умеет.
func parseProxy(link string) (Server, error) {
	u, err := url.Parse(link)
	if err != nil {
		return Server{}, err
	}
	host, port, err := hostPort(u)
	if err != nil {
		return Server{}, err
	}
	srv := map[string]any{"address": host, "port": port}
	if u.User != nil && u.User.Username() != "" {
		pass, _ := u.User.Password()
		srv["users"] = []any{map[string]any{"user": u.User.Username(), "pass": pass}}
	}
	protocol, label := "socks", "SOCKS5"
	out := map[string]any{"settings": map[string]any{"servers": []any{srv}}}
	if strings.HasPrefix(u.Scheme, "http") {
		protocol, label = "http", "HTTP"
		if u.Scheme == "https" {
			label = "HTTPS"
			out["streamSettings"] = map[string]any{"security": "tls", "tlsSettings": map[string]any{"serverName": host}}
		}
	}
	out["protocol"] = protocol
	return Server{Name: name(u, host), Protocol: label, Outbound: mustJSON(out)}, nil
}
