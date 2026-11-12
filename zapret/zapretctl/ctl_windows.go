//go:build windows

package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	serviceName = "CloudVPNZapret"
	displayName = "Cloud VPN — обход блокировок (zapret)"
	// права на общую копию: владелец — Администраторы, писать могут только SYSTEM и Администраторы,
	// остальные — читать и запускать. Служба работает от SYSTEM: подменить её файлы не должен никто, кроме админа.
	dirSDDL = "O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)"
)

type manifest struct {
	Bundle  int               `json:"bundle"`
	Version string            `json:"version"`
	Files   map[string]string `json:"files"`
}

type presetFile struct {
	Default string `json:"default"`
	Presets []struct {
		ID   string   `json:"id"`
		Name string   `json:"name"`
		Args []string `json:"args"`
	} `json:"presets"`
}

type config struct {
	Preset     string `json:"preset"`
	GameFilter bool   `json:"gameFilter"`
	Bundle     int    `json:"bundle"`
}

func sharedDir() string {
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = `C:\ProgramData`
	}
	return filepath.Join(pd, "CloudVPN", "zapret")
}

func bundleDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func elevated() bool { return windows.GetCurrentProcessToken().IsElevated() }

func logf(format string, args ...any) {
	f, err := os.OpenFile(filepath.Join(sharedDir(), "zapretctl.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	if st, err := f.Stat(); err == nil && st.Size() > 1<<20 {
		_ = f.Truncate(0)
	}
	fmt.Fprintf(f, "%s %s\n", time.Now().Format("2006-01-02 15:04:05"), fmt.Sprintf(format, args...))
}

func run(o options) int {
	switch o.cmd {
	case "status":
		return emit(Result{OK: true, Status: status()}, o.result)
	case "presets":
		return emit(Result{OK: true, Status: status()}, o.result)
	}
	if !elevated() {
		return relaunchElevated(o)
	}
	var err error
	switch o.cmd {
	case "start":
		err = start(o)
	case "stop":
		err = stop()
	case "uninstall":
		if err = stop(); err == nil {
			err = os.RemoveAll(sharedDir())
		}
	}
	if err != nil {
		logf("%s: %v", o.cmd, err)
		return emit(Result{Error: err.Error(), Status: status()}, o.result)
	}
	logf("%s: готово", o.cmd)
	return emit(Result{OK: true, Status: status()}, o.result)
}

// ---------- повышение прав: та же команда через окно UAC, ответ — через файл ----------

type shellExecuteInfo struct {
	cbSize       uint32
	fMask        uint32
	hwnd         uintptr
	lpVerb       *uint16
	lpFile       *uint16
	lpParameters *uint16
	lpDirectory  *uint16
	nShow        int32
	hInstApp     uintptr
	lpIDList     uintptr
	lpClass      *uint16
	hkeyClass    uintptr
	dwHotKey     uint32
	hIcon        uintptr
	hProcess     windows.Handle
}

var procShellExecuteExW = windows.NewLazySystemDLL("shell32.dll").NewProc("ShellExecuteExW")

func relaunchElevated(o options) int {
	exe, err := os.Executable()
	if err != nil {
		return emit(Result{Error: err.Error()}, o.result)
	}
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("zapretctl-%d-%d.json", os.Getpid(), time.Now().UnixNano()))
	args := []string{o.cmd}
	if o.preset != "" {
		args = append(args, "--preset", o.preset)
	}
	if o.gameFilter {
		args = append(args, "--game-filter")
	}
	args = append(args, "--result", tmp)
	for i, a := range args {
		args[i] = windows.EscapeArg(a)
	}
	verb, _ := windows.UTF16PtrFromString("runas")
	file, _ := windows.UTF16PtrFromString(exe)
	params, _ := windows.UTF16PtrFromString(strings.Join(args, " "))
	dir, _ := windows.UTF16PtrFromString(filepath.Dir(exe))
	sei := shellExecuteInfo{fMask: 0x40 | 0x100, lpVerb: verb, lpFile: file, lpParameters: params, lpDirectory: dir, nShow: 0}
	sei.cbSize = uint32(unsafe.Sizeof(sei))
	if r, _, e := procShellExecuteExW.Call(uintptr(unsafe.Pointer(&sei))); r == 0 {
		if errors.Is(e, windows.ERROR_CANCELLED) {
			emit(Result{Error: "отменено в окне Windows: без прав администратора zapret не включить и не выключить", Status: status()}, o.result)
			return 2
		}
		return emit(Result{Error: fmt.Sprintf("права администратора: %v", e), Status: status()}, o.result)
	}
	defer windows.CloseHandle(sei.hProcess)
	if ev, _ := windows.WaitForSingleObject(sei.hProcess, 5*60*1000); ev != windows.WAIT_OBJECT_0 {
		return emit(Result{Error: "zapretctl с правами администратора не ответил за 5 минут", Status: status()}, o.result)
	}
	var code uint32
	_ = windows.GetExitCodeProcess(sei.hProcess, &code)
	b, err := os.ReadFile(tmp)
	_ = os.Remove(tmp)
	if err != nil {
		return emit(Result{Error: "нет ответа от zapretctl с правами администратора", Status: status()}, o.result)
	}
	if o.result != "" {
		_ = os.WriteFile(o.result, b, 0o600)
	}
	fmt.Println(strings.TrimSpace(string(b)))
	return int(code)
}

// ---------- общая копия в %ProgramData% ----------

func fileSHA(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

// trustedOwner — папкой владеют Администраторы или SYSTEM (а не пользователь, создавший её заранее).
func trustedOwner(path string) bool {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION)
	if err != nil {
		return false
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil {
		return false
	}
	return owner.IsWellKnown(windows.WinBuiltinAdministratorsSid) || owner.IsWellKnown(windows.WinLocalSystemSid)
}

func lockDir(path string) error {
	sd, err := windows.SecurityDescriptorFromString(dirSDDL)
	if err != nil {
		return err
	}
	owner, _, _ := sd.Owner()
	dacl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT,
		windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, owner, nil, dacl, nil)
}

func prepareDir(dst string) error {
	if st, err := os.Stat(dst); err == nil && st.IsDir() && !trustedOwner(dst) {
		// папку создал не администратор: в ней могли оставить свои DLL — удаляем целиком
		logf("папка %s создана не администратором, пересоздаю", dst)
		if err := os.RemoveAll(dst); err != nil {
			return fmt.Errorf("папка %s чужая и не удаляется: %w", dst, err)
		}
	}
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	if err := lockDir(dst); err != nil {
		return fmt.Errorf("права на %s: %w", dst, err)
	}
	return nil
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".new"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// sync — общая копия = пакет рядом с программой (если он не старее), каждый файл сверяется по SHA-256.
func syncShared(dst string) (manifest, error) {
	src := bundleDir()
	var mine, inst manifest
	if err := readJSON(filepath.Join(src, "bundle.json"), &mine); err != nil {
		return mine, fmt.Errorf("рядом с zapretctl нет пакета zapret: %w", err)
	}
	_ = readJSON(filepath.Join(dst, "bundle.json"), &inst)
	use, from := mine, src
	if strings.EqualFold(filepath.Clean(src), filepath.Clean(dst)) {
		use, from = mine, ""
	} else if inst.Bundle > mine.Bundle {
		use, from = inst, "" // общую копию уже обновила более новая программа
	}
	for rel, want := range use.Files {
		p := filepath.Join(dst, filepath.FromSlash(rel))
		if fileSHA(p) == want {
			continue
		}
		if from == "" {
			return use, fmt.Errorf("общая копия zapret повреждена (%s) — обновите программу", rel)
		}
		if err := copyFile(filepath.Join(from, filepath.FromSlash(rel)), p); err != nil {
			if strings.HasSuffix(strings.ToLower(rel), ".sys") {
				stopDriver() // старый драйвер держит файл
				err = copyFile(filepath.Join(from, filepath.FromSlash(rel)), p)
			}
			if err != nil {
				return use, fmt.Errorf("не скопировать %s: %w", rel, err)
			}
		}
		if fileSHA(p) != want {
			return use, fmt.Errorf("%s в пакете программы не совпал с bundle.json", rel)
		}
	}
	// лишние исполняемые файлы (старые версии, подброшенные DLL) не должны лежать рядом с winws.exe
	for _, sub := range []string{"", "bin"} {
		entries, _ := os.ReadDir(filepath.Join(dst, sub))
		for _, e := range entries {
			rel := filepath.ToSlash(filepath.Join(sub, e.Name()))
			ext := strings.ToLower(filepath.Ext(e.Name()))
			if _, ok := use.Files[rel]; !ok && !e.IsDir() && (ext == ".exe" || ext == ".dll" || ext == ".sys") {
				_ = os.Remove(filepath.Join(dst, filepath.FromSlash(rel)))
			}
		}
	}
	if from != "" {
		raw, _ := json.MarshalIndent(use, "", " ")
		if err := os.WriteFile(filepath.Join(dst, "bundle.json"), raw, 0o644); err != nil {
			return use, err
		}
	}
	// свои списки пользователя — как у Flowseal: файлы не должны быть пустыми
	user := map[string]string{
		"ipset-exclude-user.txt": "203.0.113.113/32\r\n",
		"list-general-user.txt":  "# Never leave this file empty\r\ndomain.example.abc\r\n",
		"list-exclude-user.txt":  "domain.example.abc\r\n",
	}
	for name, body := range user {
		p := filepath.Join(dst, "lists", name)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			_ = os.WriteFile(p, []byte(body), 0o644)
		}
	}
	return use, nil
}

// ---------- служба ----------

func presetArgs(dir string, name string, gameFilter bool) (string, []string, error) {
	var pf presetFile
	if err := readJSON(filepath.Join(dir, "presets.json"), &pf); err != nil {
		return "", nil, fmt.Errorf("нет списка стратегий: %w", err)
	}
	if name == "" {
		name = pf.Default
	}
	game := "12" // как у Flowseal, когда игровой фильтр выключен
	if gameFilter {
		game = "1024-65535"
	}
	r := strings.NewReplacer("{BIN}", filepath.Join(dir, "bin")+`\`, "{LISTS}", filepath.Join(dir, "lists")+`\`,
		"{GAME_TCP}", game, "{GAME_UDP}", game, "{GAME}", game)
	for _, p := range pf.Presets {
		if p.ID == name {
			out := make([]string, len(p.Args))
			for i, a := range p.Args {
				out[i] = r.Replace(a)
			}
			return p.ID, out, nil
		}
	}
	return "", nil, fmt.Errorf("нет стратегии %q", name)
}

func hidden(cmd *exec.Cmd) *exec.Cmd {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd
}

func dryRun(exe string, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var out bytes.Buffer
	cmd := hidden(exec.CommandContext(ctx, exe, append([]string{"--dry-run"}, args...)...))
	cmd.Dir = filepath.Dir(exe)
	cmd.Stdout, cmd.Stderr = &out, &out
	if err := cmd.Run(); err != nil {
		tail := strings.TrimSpace(out.String())
		if len(tail) > 400 {
			tail = tail[len(tail)-400:]
		}
		return fmt.Errorf("winws не принял стратегию: %v %s", err, tail)
	}
	return nil
}

func start(o options) error {
	st := status()
	if len(st.Others) > 0 {
		return fmt.Errorf("уже работает другой обход блокировок: %s — выключите его, чтобы не мешали друг другу", strings.Join(st.Others, ", "))
	}
	dst := sharedDir()
	if err := stopService(); err != nil { // файлы работающей службы заняты
		return err
	}
	if err := prepareDir(dst); err != nil {
		return err
	}
	mf, err := syncShared(dst)
	if err != nil {
		return err
	}
	var cfg config
	_ = readJSON(filepath.Join(dst, "config.json"), &cfg)
	preset := o.preset
	if preset == "" {
		preset = cfg.Preset
	}
	gameFilter := o.gameFilter
	preset, args, err := presetArgs(dst, preset, gameFilter)
	if err != nil && o.preset == "" {
		preset, args, err = presetArgs(dst, "", gameFilter) // сохранённой стратегии больше нет в пакете
	}
	if err != nil {
		return err
	}
	winws := filepath.Join(dst, "bin", "winws.exe")
	if err := dryRun(winws, args); err != nil {
		return err
	}
	// некоторым стратегиям нужны отметки времени TCP — Flowseal включает их так же
	_ = hidden(exec.Command("netsh", "interface", "tcp", "set", "global", "timestamps=enabled")).Run()

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("службы Windows: %w", err)
	}
	defer m.Disconnect()
	desc := "Обход блокировок без VPN: zapret (bol-van) со стратегией Flowseal «" + preset + "». Включается и выключается в Cloud VPN, Cloud Browser и Chihua Browser."
	s, err := m.OpenService(serviceName)
	if err == nil {
		c, cerr := s.Config()
		if cerr != nil {
			s.Close()
			return cerr
		}
		parts := []string{windows.EscapeArg(winws)}
		for _, a := range args {
			parts = append(parts, windows.EscapeArg(a))
		}
		c.BinaryPathName = strings.Join(parts, " ")
		c.StartType = mgr.StartAutomatic
		c.DisplayName = displayName
		c.Description = desc
		if err := s.UpdateConfig(c); err != nil {
			s.Close()
			return fmt.Errorf("служба: %w", err)
		}
	} else {
		s, err = m.CreateService(serviceName, winws, mgr.Config{DisplayName: displayName, Description: desc, StartType: mgr.StartAutomatic}, args...)
		if err != nil {
			return fmt.Errorf("служба не создалась: %w", err)
		}
	}
	defer s.Close()
	_ = s.SetRecoveryActions([]mgr.RecoveryAction{{Type: mgr.ServiceRestart, Delay: 5 * time.Second}, {Type: mgr.ServiceRestart, Delay: 30 * time.Second}}, 3600)
	if err := s.Start(); err != nil {
		return fmt.Errorf("служба не запустилась: %w", err)
	}
	deadline := time.Now().Add(20 * time.Second)
	for {
		q, err := s.Query()
		if err != nil {
			return err
		}
		if q.State == svc.Running {
			break
		}
		if q.State == svc.Stopped {
			return fmt.Errorf("winws сразу остановился (код %d): драйвер WinDivert не загрузился — антивирус или другой обход блокировок", q.Win32ExitCode)
		}
		if time.Now().After(deadline) {
			return errors.New("служба zapret не запустилась за 20 секунд")
		}
		time.Sleep(300 * time.Millisecond)
	}
	cfg = config{Preset: preset, GameFilter: gameFilter, Bundle: mf.Bundle}
	raw, _ := json.Marshal(cfg)
	_ = os.WriteFile(filepath.Join(dst, "config.json"), raw, 0o644)
	logf("включено: %s, игровой фильтр %v, пакет %d", preset, gameFilter, mf.Bundle)
	return nil
}

func stopService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("службы Windows: %w", err)
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return nil // службы нет
	}
	defer s.Close()
	q, err := s.Query()
	if err == nil && q.State != svc.Stopped {
		_, _ = s.Control(svc.Stop)
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			if q, err = s.Query(); err != nil || q.State == svc.Stopped {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
		if q.State != svc.Stopped {
			return errors.New("служба zapret не остановилась за 15 секунд")
		}
	}
	return nil
}

func stop() error {
	if err := stopService(); err != nil {
		return err
	}
	if m, err := mgr.Connect(); err == nil {
		if s, err := m.OpenService(serviceName); err == nil {
			_ = s.Delete() // без службы zapret не включится сам после перезагрузки
			s.Close()
		}
		m.Disconnect()
	}
	if len(processes(0)) == 0 {
		stopDriver()
	}
	logf("выключено")
	return nil
}

// stopDriver выгружает WinDivert, как Flowseal при удалении: следующий запуск поставит драйвер заново.
func stopDriver() {
	m, err := mgr.Connect()
	if err != nil {
		return
	}
	defer m.Disconnect()
	for _, name := range []string{"WinDivert", "WinDivert14"} {
		s, err := m.OpenService(name)
		if err != nil {
			continue
		}
		_, _ = s.Control(svc.Stop)
		_ = s.Delete()
		s.Close()
	}
}

// ---------- состояние (без прав администратора) ----------

func queryService(name string) (exists bool, state uint32, pid uint32) {
	scm, err := windows.OpenSCManager(nil, nil, windows.SC_MANAGER_CONNECT)
	if err != nil {
		return false, 0, 0
	}
	defer windows.CloseServiceHandle(scm)
	n, _ := windows.UTF16PtrFromString(name)
	h, err := windows.OpenService(scm, n, windows.SERVICE_QUERY_STATUS)
	if err != nil {
		return false, 0, 0
	}
	defer windows.CloseServiceHandle(h)
	var p windows.SERVICE_STATUS_PROCESS
	var need uint32
	if err := windows.QueryServiceStatusEx(h, windows.SC_STATUS_PROCESS_INFO, (*byte)(unsafe.Pointer(&p)), uint32(unsafe.Sizeof(p)), &need); err != nil {
		return true, 0, 0
	}
	return true, p.CurrentState, p.ProcessId
}

// processes — другие программы обхода (winws, winws2, GoodbyeDPI), кроме нашей службы.
func processes(ourPID uint32) []string {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil
	}
	defer windows.CloseHandle(snap)
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	var out []string
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		name := strings.ToLower(windows.UTF16ToString(e.ExeFile[:]))
		if e.ProcessID == ourPID {
			continue
		}
		switch name {
		case "winws.exe", "winws2.exe":
			out = append(out, name+" (другой zapret)")
		case "goodbyedpi.exe":
			out = append(out, "GoodbyeDPI")
		}
	}
	return out
}

func status() *Status {
	st := &Status{Supported: true, State: "off", Dir: sharedDir(), Elevated: elevated(), Ctl: Version}
	var mine, inst manifest
	if readJSON(filepath.Join(bundleDir(), "bundle.json"), &mine) == nil {
		st.Bundle = mine.Version
	}
	if readJSON(filepath.Join(sharedDir(), "bundle.json"), &inst) == nil {
		st.InstalledBundle = inst.Version
	}
	var pf presetFile
	if readJSON(filepath.Join(bundleDir(), "presets.json"), &pf) != nil {
		_ = readJSON(filepath.Join(sharedDir(), "presets.json"), &pf)
	}
	st.Default = pf.Default
	for _, p := range pf.Presets {
		st.Presets = append(st.Presets, p.ID)
	}
	var cfg config
	if readJSON(filepath.Join(sharedDir(), "config.json"), &cfg) == nil {
		st.Preset, st.GameFilter = cfg.Preset, cfg.GameFilter
	}
	exists, state, pid := queryService(serviceName)
	st.Installed = exists
	switch state {
	case windows.SERVICE_RUNNING:
		st.State, st.Running = "running", true
	case windows.SERVICE_START_PENDING:
		st.State = "starting"
	case windows.SERVICE_STOP_PENDING:
		st.State = "stopping"
	}
	if ok, s, _ := queryService("zapret"); ok && s == windows.SERVICE_RUNNING {
		st.Others = append(st.Others, "служба zapret (другая сборка, например Flowseal)")
	}
	st.Others = append(st.Others, processes(pid)...) // свой winws (PID службы) не считается
	return st
}
