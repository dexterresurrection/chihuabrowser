//go:build windows

package platform

import (
	"crypto/sha256"
	"encoding/hex"
	"os/exec"
	"sync"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const createNoWindow = 0x08000000

// Background запускает процесс без окна консоли.
func Background(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
}

var (
	jobOnce sync.Once
	job     windows.Handle
)

// BindToParent: xray должен умереть вместе с лаунчером, даже если тот упал. Для этого нужен объект задания с KILL_ON_JOB_CLOSE.
func BindToParent(c *exec.Cmd) {
	jobOnce.Do(func() {
		h, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			return
		}
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
		info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
		if _, err := windows.SetInformationJobObject(h, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
			_ = windows.CloseHandle(h)
			return
		}
		job = h
	})
	if job == 0 || c.Process == nil {
		return
	}
	p, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(c.Process.Pid))
	if err != nil {
		return
	}
	defer func() { _ = windows.CloseHandle(p) }()
	_ = windows.AssignProcessToJobObject(job, p)
}

// DeviceID: хэш MachineGuid. Настоящий и постоянный идентификатор этого компьютера, чтобы лимит устройств в подписке считал его верно.
func DeviceID() string {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, err := k.GetStringValue("MachineGuid")
	if err != nil || v == "" {
		return ""
	}
	sum := sha256.Sum256([]byte("chihua:" + v))
	return hex.EncodeToString(sum[:16])
}

// Alert показывает ошибку окном: у лаунчера нет консоли.
func Alert(title, text string) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(text)
	_, _ = windows.MessageBox(0, m, t, windows.MB_OK|windows.MB_ICONERROR)
}

// ExeSuffix — окончание исполняемого файла.
const ExeSuffix = ".exe"

// WaitPID ждёт завершения процесса, но не дольше минуты.
func WaitPID(pid int) {
	h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid))
	if err != nil {
		return
	}
	defer func() { _ = windows.CloseHandle(h) }()
	_, _ = windows.WaitForSingleObject(h, 60000)
}
