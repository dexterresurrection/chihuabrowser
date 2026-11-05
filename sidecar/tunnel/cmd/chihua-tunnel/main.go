// chihua-tunnel turns subscription links into a local SOCKS5 port through xray.
//
//	chihua-tunnel list          subscription text on stdin, JSON list of servers on stdout
//	chihua-tunnel run --xray X --port N    link on the first line of stdin, prints "ready" once the port is open
//
// The link comes through stdin so that it never shows up in a process list. The program exits when stdin closes,
// so it cannot outlive the browser that started it.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"chihuabrowser/tunnel"
)

type listed struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Link     string `json:"link"`
}

func main() {
	if len(os.Args) < 2 {
		fail("usage: chihua-tunnel list | run --xray PATH --port N")
	}
	switch os.Args[1] {
	case "list":
		body, err := io.ReadAll(io.LimitReader(os.Stdin, 16<<20))
		if err != nil {
			fail(err.Error())
		}
		out := []listed{}
		for _, s := range tunnel.ParseSubscription(string(body)) {
			out = append(out, listed{s.ID, s.Name, s.Protocol, s.Link})
		}
		if err := json.NewEncoder(os.Stdout).Encode(out); err != nil {
			fail(err.Error())
		}
	case "run":
		fs := flag.NewFlagSet("run", flag.ExitOnError)
		xray := fs.String("xray", "", "path to xray")
		port := fs.Int("port", 0, "local SOCKS5 port")
		_ = fs.Parse(os.Args[2:])
		in := bufio.NewReader(os.Stdin)
		line, err := in.ReadString('\n')
		if err != nil && line == "" {
			fail("no link on stdin")
		}
		server, err := tunnel.ParseLink(strings.TrimSpace(line))
		if err != nil {
			fail(err.Error())
		}
		t := tunnel.New(*xray)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		_, err = t.StartOn(ctx, server, *port)
		cancel()
		if err != nil {
			fail(err.Error())
		}
		fmt.Println("ready")
		_, _ = io.Copy(io.Discard, in)
		t.Stop()
	default:
		fail("unknown command " + os.Args[1])
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
