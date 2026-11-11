<div align="center">
  <img src="assets/logo.png" alt="Chihua Browser" width="120">
  <h1>Chihua Browser</h1>
  <p>Free anti-detect browser: separate profiles, each with its own fingerprint, cookies, extensions and proxy.</p>
</div>

**Status: test builds.** Every build is published right away for testing (Cloud VPN bot → «📲 Приложения»).

Everything is free. There are no paid plans, no accounts with a vendor, no trial and no telemetry.

## What it is

A fork of Donut Browser 0.27 (the last version with a free engine). Everything that talked to the original vendor is
removed: their cloud login and sync, team locks, commercial licence checks, the proprietary Wayfern engine and its
terms. Cloud VPN is built in instead:

- sign in to your Cloud VPN account inside the browser (code by e-mail or password);
- servers from your subscription appear as proxies, any profile can use one;
- the tunnel (Xray) runs inside the browser, nothing else to install;
- the Cloud VPN extension (VPN and ad blocking) is added to every profile.

## Engines

- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) (BSD-3-Clause): Chromium with fingerprints set inside the engine.
- [Camoufox](https://github.com/daijro/camoufox) (MPL-2.0): Firefox with fingerprints set inside the engine.

Both are downloaded from their own GitHub releases when a profile first needs them.

## Build

See `.github/workflows/build.yml`. The workflow uses no repository secrets.

## License

AGPL-3.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Source code of every release is in this repository.
