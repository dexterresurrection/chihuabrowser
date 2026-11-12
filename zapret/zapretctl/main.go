// zapretctl — общий для Cloud VPN для Windows, Cloud Browser и Chihua Browser переключатель обхода блокировок zapret.
//
//	zapretctl status                         состояние (JSON), без прав администратора
//	zapretctl presets                        стратегии из пакета (JSON)
//	zapretctl start [--preset ИМЯ] [--game-filter]   включить: копия пакета в %ProgramData%\CloudVPN\zapret, служба Windows
//	zapretctl stop                           выключить: служба удаляется, драйвер WinDivert выгружается, если он больше никому не нужен
//	zapretctl uninstall                      выключить и удалить общую копию
//
// Включение и выключение просят права администратора (окно UAC), если их нет. Ответ — одна строка JSON
// {"ok":…,"error":…,"status":{…}}; код выхода 0 — успех, 1 — ошибка, 2 — отказ в окне UAC.
package main

import (
	"encoding/json"
	"fmt"
	"os"
)

// Version — версия zapretctl (в ответе status).
const Version = "1.0.0"

// Status — состояние zapret в системе.
type Status struct {
	Supported       bool     `json:"supported"`
	Installed       bool     `json:"installed"` // служба есть
	Running         bool     `json:"running"`
	State           string   `json:"state"` // off, starting, running, stopping
	Preset          string   `json:"preset,omitempty"`
	GameFilter      bool     `json:"gameFilter,omitempty"`
	Bundle          string   `json:"bundle,omitempty"`          // версия пакета рядом с программой
	InstalledBundle string   `json:"installedBundle,omitempty"` // версия общей копии
	Dir             string   `json:"dir,omitempty"`
	Others          []string `json:"others,omitempty"` // другой zapret или GoodbyeDPI в системе
	Presets         []string `json:"presets,omitempty"`
	Default         string   `json:"default,omitempty"`
	Elevated        bool     `json:"elevated"`
	Ctl             string   `json:"ctl"`
}

// Result — ответ команды.
type Result struct {
	OK     bool    `json:"ok"`
	Error  string  `json:"error,omitempty"`
	Status *Status `json:"status,omitempty"`
}

func emit(r Result, resultFile string) int {
	b, _ := json.Marshal(r)
	if resultFile != "" {
		_ = os.WriteFile(resultFile, b, 0o600)
	}
	fmt.Println(string(b))
	if r.OK {
		return 0
	}
	return 1
}

type options struct {
	cmd        string
	preset     string
	gameFilter bool
	result     string // файл ответа: повышенная копия пишет туда, исходная читает
}

func parse(args []string) (options, error) {
	var o options
	for i := 0; i < len(args); i++ {
		a := args[i]
		next := func() (string, error) {
			if i+1 >= len(args) {
				return "", fmt.Errorf("после %s нужно значение", a)
			}
			i++
			return args[i], nil
		}
		var err error
		switch a {
		case "status", "presets", "start", "stop", "uninstall":
			if o.cmd != "" {
				return o, fmt.Errorf("две команды: %s и %s", o.cmd, a)
			}
			o.cmd = a
		case "--preset":
			o.preset, err = next()
		case "--game-filter":
			o.gameFilter = true
		case "--result":
			o.result, err = next()
		default:
			return o, fmt.Errorf("непонятный аргумент %q", a)
		}
		if err != nil {
			return o, err
		}
	}
	if o.cmd == "" {
		o.cmd = "status"
	}
	return o, nil
}

func main() {
	o, err := parse(os.Args[1:])
	if err != nil {
		os.Exit(emit(Result{Error: err.Error()}, ""))
	}
	os.Exit(run(o))
}
