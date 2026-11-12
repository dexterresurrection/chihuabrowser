//go:build !windows

package main

func run(o options) int {
	return emit(Result{Error: "zapret есть только в Windows", Status: &Status{Supported: false, State: "off", Ctl: Version}}, o.result)
}
