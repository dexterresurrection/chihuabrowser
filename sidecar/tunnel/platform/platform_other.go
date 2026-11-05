//go:build !windows

package platform

import "os/exec"

// Background: окно консоли есть только в Windows.
func Background(*exec.Cmd) {}

// BindToParent: в тестах на Linux родитель останавливает xray сам.
func BindToParent(*exec.Cmd) {}

// DeviceID: настоящий идентификатор устройства есть только в Windows.
func DeviceID() string { return "" }

// Alert показывает ошибку там, где нет консоли.
func Alert(string, string) {}

// ExeSuffix — окончание исполняемого файла.
const ExeSuffix = ""

// WaitPID ждёт завершения процесса (только Windows; здесь не нужно).
func WaitPID(int) {}
