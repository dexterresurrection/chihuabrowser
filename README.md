<div align="center">
  <img src="assets/logo.png" alt="Chihua Browser" width="120">
  <h1>Chihua Browser</h1>
  <p>Free anti-detect browser: separate profiles, each with its own fingerprint, cookies, extensions and proxy.</p>
</div>

**Status: in development, no release yet.**

Everything is free. There are no paid plans, no accounts with a vendor, no trial and no telemetry.

## Engines

- [fingerprint-chromium](https://github.com/adryfish/fingerprint-chromium) (BSD-3-Clause): Chromium with fingerprints set inside the engine.
- [Camoufox](https://github.com/daijro/camoufox) (MPL-2.0): Firefox with fingerprints set inside the engine.

Both are downloaded from their own GitHub releases when a profile first needs them.

## Build

See `.github/workflows/build.yml`. The workflow uses no repository secrets.

## License

AGPL-3.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Source code of every release is in this repository.
