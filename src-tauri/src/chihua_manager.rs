use crate::browser_runner::BrowserRunner;
use crate::profile::BrowserProfile;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::AppHandle;
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex as AsyncMutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChihuaConfig {
  #[serde(default)]
  pub fingerprint: Option<String>,
  #[serde(default)]
  pub randomize_fingerprint_on_launch: Option<bool>,
  #[serde(default)]
  pub os: Option<String>,
  #[serde(default)]
  pub screen_max_width: Option<u32>,
  #[serde(default)]
  pub screen_max_height: Option<u32>,
  #[serde(default)]
  pub screen_min_width: Option<u32>,
  #[serde(default)]
  pub screen_min_height: Option<u32>,
  #[serde(default)]
  pub geoip: Option<serde_json::Value>, // For compatibility with shared config form
  #[serde(default)]
  pub block_images: Option<bool>, // For compatibility with shared config form
  #[serde(default)]
  pub block_webrtc: Option<bool>,
  #[serde(default)]
  pub block_webgl: Option<bool>,
  #[serde(default, skip_serializing)]
  pub proxy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(non_snake_case)]
pub struct ChihuaLaunchResult {
  pub id: String,
  #[serde(alias = "process_id")]
  pub processId: Option<u32>,
  #[serde(alias = "profile_path")]
  pub profilePath: Option<String>,
  pub url: Option<String>,
  pub cdp_port: Option<u16>,
  /// The fingerprint Chihua actually applied, echoed back by
  /// Chihua.setFingerprint. It may be UPGRADED from the stored fingerprint
  /// (e.g. when the stored one targets an older browser version). Internal
  /// only — the caller persists it to the profile; never sent to the frontend.
  #[serde(default, skip_serializing)]
  pub used_fingerprint: Option<String>,
}

struct ChihuaInstance {
  id: String,
  process_id: Option<u32>,
  profile_path: Option<String>,
  url: Option<String>,
  cdp_port: Option<u16>,
}

struct ChihuaManagerInner {
  instances: HashMap<String, ChihuaInstance>,
}

pub struct ChihuaManager {
  inner: Arc<AsyncMutex<ChihuaManagerInner>>,
  http_client: Client,
}

#[derive(Debug, Deserialize)]
struct CdpTarget {
  #[serde(rename = "type")]
  target_type: String,
  #[serde(rename = "webSocketDebuggerUrl")]
  websocket_debugger_url: Option<String>,
}

impl ChihuaManager {
  fn new() -> Self {
    Self {
      inner: Arc::new(AsyncMutex::new(ChihuaManagerInner {
        instances: HashMap::new(),
      })),
      http_client: Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("Failed to build reqwest client for chihua_manager"),
    }
  }

  pub fn instance() -> &'static ChihuaManager {
    &CHIHUA_MANAGER
  }

  #[allow(dead_code)]
  pub fn get_profiles_dir(&self) -> PathBuf {
    crate::app_dirs::profiles_dir()
  }

  #[allow(dead_code)]
  fn get_binaries_dir(&self) -> PathBuf {
    crate::app_dirs::binaries_dir()
  }

  async fn find_free_port() -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
  }

  /// Chihua returns fields like fonts, webglParameters as JSON strings which we keep as-is.
  fn normalize_fingerprint(fingerprint: serde_json::Value) -> serde_json::Value {
    // Our storage format matches what Chihua returns:
    // - fonts, plugins, mimeTypes, voices are JSON strings
    // - webglParameters, webgl2Parameters, etc. are JSON strings
    // The form displays them as JSON text areas, so no conversion needed.
    fingerprint
  }

  /// Denormalize fingerprint data from our storage format to Chihua CDP format.
  /// Chihua expects certain fields as JSON strings.
  /// Derive the on-screen window size Chromium should open at, from the stored
  /// fingerprint. `Chihua.setFingerprint` only spoofs what the page *reports*
  /// for `windowOuterWidth`/`screenWidth`/etc.; it does not move or resize the
  /// real top-level window. Without `--window-size` the OS window keeps
  /// Chromium's default, so the visible window contradicts the reported
  /// dimensions — a detectable mismatch. We pass `--window-size` so the actual
  /// window matches the fingerprint.
  ///
  /// Keys are the camelCase fields Chihua uses in its fingerprint
  /// (`windowOuterWidth`, `screenAvailWidth`, …) — NOT the dotted
  /// Camoufox-style keys. Preference order, matching how the fingerprint
  /// describes the window:
  /// 1. `windowOuterWidth` / `windowOuterHeight` — the real window size.
  /// 2. `screenAvailWidth` / `screenAvailHeight` — usable screen area.
  /// 3. `screenWidth` / `screenHeight` — full screen.
  ///
  /// Returns `None` when the fingerprint carries no usable dimensions, leaving
  /// Chromium's default untouched. The fingerprint JSON may be the bare object
  /// or the legacy `{ "fingerprint": {...} }` wrapper.
  fn window_size_from_fingerprint(fingerprint_json: &str) -> Option<(u32, u32)> {
    let parsed: serde_json::Value = serde_json::from_str(fingerprint_json).ok()?;
    let fp = parsed.get("fingerprint").unwrap_or(&parsed);
    let obj = fp.as_object()?;

    // Accept both numeric and stringified numbers (Chihua emits numbers, but a
    // CDP echo or older saved fingerprint may stringify them).
    let read = |key: &str| -> Option<u32> {
      let v = obj.get(key)?;
      v.as_u64()
        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<u64>().ok()))
        .filter(|n| *n > 0)
        .map(|n| n as u32)
    };
    let pair = |w: &str, h: &str| -> Option<(u32, u32)> { Some((read(w)?, read(h)?)) };

    pair("windowOuterWidth", "windowOuterHeight")
      .or_else(|| pair("screenAvailWidth", "screenAvailHeight"))
      .or_else(|| pair("screenWidth", "screenHeight"))
  }

  async fn wait_for_cdp_ready(
    &self,
    port: u16,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("http://127.0.0.1:{port}/json/version");
    // On first launch, macOS Gatekeeper verifies the binary which can take 30+ seconds.
    // Use a generous timeout (60s) to handle this.
    let max_attempts = 120;
    let delay = Duration::from_millis(500);

    let mut last_error: Option<String> = None;
    for attempt in 0..max_attempts {
      match self.http_client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => {
          log::info!("CDP ready on port {port} after {attempt} attempts");
          return Ok(());
        }
        Ok(resp) => {
          last_error = Some(format!("HTTP {} from {url}", resp.status()));
          tokio::time::sleep(delay).await;
        }
        Err(e) => {
          last_error = Some(format!("request failed: {e}"));
          tokio::time::sleep(delay).await;
        }
      }
    }

    let detail = last_error.unwrap_or_else(|| "no attempts completed".to_string());
    // Log at error level so we can diagnose Windows/AV/firewall-induced CDP hangs
    // in customer reports without needing them to reproduce in the moment.
    log::error!("CDP not ready after {max_attempts} attempts on port {port}: {detail}");
    Err(format!("CDP not ready after {max_attempts} attempts on port {port}: {detail}").into())
  }

  async fn get_cdp_targets(
    &self,
    port: u16,
  ) -> Result<Vec<CdpTarget>, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("http://127.0.0.1:{port}/json");
    let resp = self.http_client.get(&url).send().await?;
    let targets: Vec<CdpTarget> = resp.json().await?;
    Ok(targets)
  }

  async fn send_cdp_command(
    &self,
    ws_url: &str,
    method: &str,
    params: serde_json::Value,
  ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
    let (mut ws_stream, _) = connect_async(ws_url).await?;

    let command = json!({
      "id": 1,
      "method": method,
      "params": params
    });

    use futures_util::sink::SinkExt;
    use futures_util::stream::StreamExt;

    ws_stream
      .send(Message::Text(command.to_string().into()))
      .await?;

    while let Some(msg) = ws_stream.next().await {
      match msg? {
        Message::Text(text) => {
          let response: serde_json::Value = serde_json::from_str(text.as_str())?;
          if response.get("id") == Some(&json!(1)) {
            if let Some(error) = response.get("error") {
              return Err(format!("CDP error: {}", error).into());
            }
            return Ok(response.get("result").cloned().unwrap_or(json!({})));
          }
        }
        Message::Close(_) => break,
        _ => {}
      }
    }

    Err("No response received from CDP".into())
  }

  /// The engine builds the whole device from the seed, so a profile only keeps the seed and the
  /// few values passed as switches. A new seed is a new device.
  pub async fn generate_fingerprint_config(
    &self,
    _app_handle: &AppHandle,
    _profile: &BrowserProfile,
    config: &ChihuaConfig,
  ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let os = config
      .os
      .as_deref()
      .unwrap_or(if cfg!(target_os = "macos") {
        "macos"
      } else if cfg!(target_os = "linux") {
        "linux"
      } else {
        "windows"
      });
    let random = uuid::Uuid::new_v4().as_u128();
    let seed = ((random >> 32) as u32).max(1);
    let cores = [4u32, 6, 8, 12, 16][(random % 5) as usize];
    let mut fingerprint = json!({
      "seed": seed,
      "platform": os,
      "brand": "Chrome",
      "hardwareConcurrency": cores,
    });

    let should_geolocate = !matches!(config.geoip, Some(serde_json::Value::Bool(false)));
    if should_geolocate {
      let geo = async {
        let ip = match config.geoip.as_ref() {
          Some(serde_json::Value::String(ip)) => ip.clone(),
          _ => crate::ip_utils::fetch_public_ip(config.proxy.as_deref())
            .await
            .map_err(|e| format!("Failed to fetch public IP: {e}"))?,
        };
        crate::camoufox::geolocation::get_geolocation(&ip)
          .map_err(|e| format!("Failed to get geolocation for IP {ip}: {e}"))
      }
      .await;
      match geo {
        Ok(geo) => {
          if let Some(obj) = fingerprint.as_object_mut() {
            let locale = geo.locale.as_string();
            obj.insert("timezone".to_string(), json!(geo.timezone));
            obj.insert("language".to_string(), json!(&locale));
            obj.insert("languages".to_string(), json!([&locale, &geo.locale.language]));
          }
        }
        Err(e) => log::warn!("Geolocation failed, keeping the system defaults: {e}"),
      }
    }

    Ok(serde_json::to_string(&fingerprint)?)
  }

  /// Command line switches of fingerprint-chromium for a stored fingerprint.
  fn engine_switches(fingerprint_json: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(fingerprint_json) else {
      return Vec::new();
    };
    let mut switches = Vec::new();
    if let Some(seed) = value.get("seed").and_then(|v| v.as_u64()) {
      switches.push(format!("--fingerprint={seed}"));
    }
    let text = |key: &str| value.get(key).and_then(|v| v.as_str()).map(str::to_string);
    if let Some(platform) = text("platform") {
      switches.push(format!("--fingerprint-platform={platform}"));
    }
    if let Some(brand) = text("brand") {
      switches.push(format!("--fingerprint-brand={brand}"));
    }
    if let Some(cores) = value.get("hardwareConcurrency").and_then(|v| v.as_u64()) {
      switches.push(format!("--fingerprint-hardware-concurrency={cores}"));
    }
    if let Some(timezone) = text("timezone") {
      switches.push(format!("--timezone={timezone}"));
    }
    if let Some(language) = text("language") {
      switches.push(format!("--lang={language}"));
    }
    if let Some(languages) = value.get("languages").and_then(|v| v.as_array()) {
      let list: Vec<&str> = languages.iter().filter_map(|l| l.as_str()).collect();
      if !list.is_empty() {
        switches.push(format!("--accept-lang={}", list.join(",")));
      }
    }
    switches
  }

  #[allow(clippy::too_many_arguments)]
  pub async fn launch_chihua(
    &self,
    _app_handle: &AppHandle,
    profile: &BrowserProfile,
    profile_path: &str,
    config: &ChihuaConfig,
    url: Option<&str>,
    proxy_url: Option<&str>,
    ephemeral: bool,
    extension_paths: &[String],
    remote_debugging_port: Option<u16>,
    headless: bool,
  ) -> Result<ChihuaLaunchResult, Box<dyn std::error::Error + Send + Sync>> {
    let executable_path = BrowserRunner::instance()
      .get_browser_executable_path(profile)
      .map_err(|e| format!("Failed to get Chihua executable path: {e}"))?;

    let port = match remote_debugging_port {
      Some(p) => p,
      None => Self::find_free_port().await?,
    };
    log::info!("Launching Chihua on CDP port {port} (detached)");

    // Diagnostic: verify critical profile files and test cookie decryption
    {
      let profile_path_buf = std::path::PathBuf::from(profile_path);
      let key_path = profile_path_buf.join("os_crypt_key");
      let cookies_path = {
        let network = profile_path_buf
          .join("Default")
          .join("Network")
          .join("Cookies");
        if network.exists() {
          network
        } else {
          profile_path_buf.join("Default").join("Cookies")
        }
      };

      if key_path.exists() {
        let key_text = std::fs::read_to_string(&key_path).unwrap_or_default();
        log::info!(
          "Pre-launch: os_crypt_key present ({} bytes, content: '{}')",
          key_text.len(),
          key_text.trim()
        );
      } else {
        log::warn!("Pre-launch: os_crypt_key NOT FOUND");
      }

      if cookies_path.exists() {
        // Try to open Cookies DB and check if encrypted cookies can be decrypted
        if let Ok(conn) = rusqlite::Connection::open_with_flags(
          &cookies_path,
          rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
          let cookie_count: i64 = conn
            .query_row(
              "SELECT COUNT(*) FROM cookies WHERE length(encrypted_value) > 0",
              [],
              |r| r.get(0),
            )
            .unwrap_or(0);
          let total_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM cookies", [], |r| r.get(0))
            .unwrap_or(0);
          log::info!(
            "Pre-launch: Cookies DB has {} total cookies, {} encrypted",
            total_count,
            cookie_count
          );

          // Try decrypting one cookie using the cookie_manager
          if let Some(encryption_key) =
            crate::cookie_manager::chrome_decrypt::get_encryption_key(&profile_path_buf)
          {
            if let Ok(mut stmt) = conn.prepare(
              "SELECT name, host_key, encrypted_value FROM cookies WHERE length(encrypted_value) > 0 LIMIT 1",
            ) {
              if let Ok(mut rows) = stmt.query([]) {
                if let Ok(Some(row)) = rows.next() {
                  let name: String = row.get(0).unwrap_or_default();
                  let host: String = row.get(1).unwrap_or_default();
                  let encrypted: Vec<u8> = row.get(2).unwrap_or_default();
                  let decrypted = crate::cookie_manager::chrome_decrypt::decrypt(
                    &encrypted,
                    &host,
                    &encryption_key,
                  );
                  match decrypted {
                    Some(val) => log::info!(
                      "Pre-launch: Cookie decryption SUCCEEDED for '{}' (host: {}, decrypted {} bytes)",
                      name, host, val.len()
                    ),
                    None => log::error!(
                      "Pre-launch: Cookie decryption FAILED for '{}' (host: {}, encrypted {} bytes)",
                      name, host, encrypted.len()
                    ),
                  }
                }
              }
            }
          } else {
            log::error!("Pre-launch: Failed to derive encryption key from os_crypt_key");
          }
        }
      } else {
        log::warn!("Pre-launch: Cookies NOT FOUND");
      }
    }

    let mut args = vec![
      format!("--remote-debugging-port={port}"),
      "--remote-debugging-address=127.0.0.1".to_string(),
      format!("--user-data-dir={profile_path}"),
      "--no-first-run".to_string(),
      "--no-default-browser-check".to_string(),
      "--disable-background-mode".to_string(),
      "--disable-component-update".to_string(),
      "--disable-background-timer-throttling".to_string(),
      "--crash-server-url=".to_string(),
      "--disable-updater".to_string(),
      "--disable-session-crashed-bubble".to_string(),
      "--hide-crash-restore-bubble".to_string(),
      "--disable-infobars".to_string(),
      // Prefetch* / NoStatePrefetch: cross-site Speculation-Rules prefetch uses
      // an isolated NetworkContext that defaults to DIRECT egress (real host IP
      // leaks past the per-profile proxy). Disabling via a LAUNCH FLAG cannot be
      // re-enabled by an imported/synced network_prediction_options pref (which a
      // compile-time pref default could be).
      "--disable-features=DialMediaRouteProvider,DnsOverHttps,AsyncDns,Prefetch,PrefetchProxy,SpeculationRulesPrefetchFuture,NoStatePrefetch".to_string(),
      "--use-mock-keychain".to_string(),
      "--password-store=basic".to_string(),
    ];

    // Расширение Cloud VPN (блокировщик рекламы и VPN) лежит рядом с программой и включается в каждом профиле
    if let Some(ext) = std::env::current_exe()
      .ok()
      .and_then(|exe| exe.parent().map(|d| d.join("cloudvpn-ext")))
      .filter(|d| d.join("manifest.json").is_file())
    {
      args.push(format!("--load-extension={}", ext.display()));
    }

    if headless {
      args.push("--headless=new".to_string());
    } else if let Some((w, h)) = config
      .fingerprint
      .as_deref()
      .and_then(Self::window_size_from_fingerprint)
    {
      // Size the real OS window to match the fingerprint so the visible window
      // agrees with the reported windowOuterWidth/screen dimensions. Anchor at
      // 0,0 so the window also fits within the spoofed screen origin. Skipped in
      // headless mode, where there is no on-screen window.
      log::info!("Sizing Chihua window to fingerprint dimensions: {w}x{h}");
      args.push(format!("--window-size={w},{h}"));
      args.push("--window-position=0,0".to_string());
    }

    #[cfg(target_os = "linux")]
    {
      args.push("--no-sandbox".to_string());
      args.push("--disable-setuid-sandbox".to_string());
      args.push("--disable-dev-shm-usage".to_string());
    }

    if ephemeral {
      args.push("--disk-cache-size=1".to_string());
      args.push("--disable-breakpad".to_string());
      args.push("--disable-crash-reporter".to_string());
      args.push("--no-service-autorun".to_string());
      args.push("--disable-sync".to_string());
    }

    if !extension_paths.is_empty() {
      args.push(format!("--load-extension={}", extension_paths.join(",")));
    }

    if let Some(fingerprint) = config.fingerprint.as_deref() {
      args.extend(Self::engine_switches(fingerprint));
    }

    if let Some(proxy) = proxy_url {
      // Map the local proxy scheme to the matching PAC directive. SOCKS5 lets
      // Chromium route UDP (QUIC/WebRTC) and resolve DNS through the proxy;
      // PROXY is HTTP CONNECT (TCP only). The host:port is the same either way.
      let (pac_directive, host_port) = if let Some(rest) = proxy.strip_prefix("socks5://") {
        ("SOCKS5", rest)
      } else {
        (
          "PROXY",
          proxy
            .trim_start_matches("http://")
            .trim_start_matches("https://"),
        )
      };
      let pac_data = format!(
        "data:application/x-ns-proxy-autoconfig,function FindProxyForURL(url,host){{return \"{pac_directive} {host_port}\";}}",
      );
      args.push(format!("--proxy-pac-url={pac_data}"));
      args.push("--dns-prefetch-disable".to_string());
    }

    let mut command = TokioCommand::new(&executable_path);
    command
      .args(&args)
      .stdin(Stdio::null())
      .stdout(Stdio::null())
      .stderr(Stdio::null());

    let child = command
      .spawn()
      .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> {
        let hint = if e.raw_os_error() == Some(14001) {
          ". This usually means the Visual C++ Redistributable is not installed. \
           Download it from https://aka.ms/vs/17/release/vc_redist.x64.exe"
        } else {
          ""
        };
        format!("Failed to spawn Chihua: {e}{hint}").into()
      })?;
    let process_id = child.id();
    drop(child);

    self.wait_for_cdp_ready(port).await?;

    let targets = self.get_cdp_targets(port).await?;
    log::info!("Found {} CDP targets", targets.len());

    let page_targets: Vec<_> = targets.iter().filter(|t| t.target_type == "page").collect();
    log::info!("Found {} page targets", page_targets.len());

    let used_fingerprint: Option<String> = None;

    // Geolocation is handled internally by the browser binary.

    if let Some(url) = url {
      log::info!("Navigating to URL via CDP: {}", url);
      if let Some(target) = page_targets.first() {
        if let Some(ws_url) = &target.websocket_debugger_url {
          if let Err(e) = self
            .send_cdp_command(ws_url, "Page.navigate", json!({ "url": url }))
            .await
          {
            log::error!("Failed to navigate to URL: {e}");
          }
        }
      }
    }

    for target in &page_targets {
      if let Some(ws_url) = &target.websocket_debugger_url {
        let _ = self
          .send_cdp_command(ws_url, "Emulation.clearDeviceMetricsOverride", json!({}))
          .await;
        let _ = self
          .send_cdp_command(
            ws_url,
            "Emulation.setFocusEmulationEnabled",
            json!({ "enabled": false }),
          )
          .await;
        let _ = self
          .send_cdp_command(
            ws_url,
            "Emulation.setEmulatedMedia",
            json!({ "media": "", "features": [] }),
          )
          .await;
      }
    }

    let id = uuid::Uuid::new_v4().to_string();
    let instance = ChihuaInstance {
      id: id.clone(),
      process_id,
      profile_path: Some(profile_path.to_string()),
      url: url.map(|s| s.to_string()),
      cdp_port: Some(port),
    };

    let mut inner = self.inner.lock().await;
    inner.instances.insert(id.clone(), instance);

    Ok(ChihuaLaunchResult {
      id,
      processId: process_id,
      profilePath: Some(profile_path.to_string()),
      url: url.map(|s| s.to_string()),
      cdp_port: Some(port),
      used_fingerprint,
    })
  }

  pub async fn stop_chihua(
    &self,
    id: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut inner = self.inner.lock().await;

    if let Some(instance) = inner.instances.remove(id) {
      log::info!("Cleaning up Chihua instance {}", instance.id);
      if let Some(pid) = instance.process_id {
        #[cfg(unix)]
        {
          use nix::sys::signal::{kill, Signal};
          use nix::unistd::Pid;
          let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
        }
        #[cfg(windows)]
        {
          use std::os::windows::process::CommandExt;
          const CREATE_NO_WINDOW: u32 = 0x08000000;
          let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        }
        log::info!("Stopped Chihua instance {id} (PID: {pid})");
      }
    }

    Ok(())
  }

  /// Opens a URL in a new tab for an existing Chihua instance.
  pub async fn open_url_in_tab(
    &self,
    profile_path: &str,
    url: &str,
  ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let inner = self.inner.lock().await;
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    let port = inner
      .instances
      .values()
      .find(|i| {
        i.profile_path
          .as_deref()
          .map(|p| {
            std::path::Path::new(p)
              .canonicalize()
              .unwrap_or_else(|_| std::path::Path::new(p).to_path_buf())
              == target_path
          })
          .unwrap_or(false)
      })
      .and_then(|i| i.cdp_port)
      .ok_or("Chihua instance (with CDP port) not found for profile")?;
    drop(inner);

    // Open the URL in a new tab via the CDP HTTP convenience endpoint.
    let new_tab_url = format!(
      "http://127.0.0.1:{port}/json/new?{}",
      urlencoding::encode(url)
    );
    let resp = self
      .http_client
      .put(&new_tab_url)
      .send()
      .await
      .map_err(|e| format!("Failed to open new tab: {e}"))?;
    if !resp.status().is_success() {
      return Err(format!("CDP /json/new returned HTTP {}", resp.status()).into());
    }

    log::info!("Opened URL in new tab via CDP: {}", url);
    Ok(())
  }

  pub async fn get_cdp_port(&self, profile_path: &str) -> Option<u16> {
    let inner = self.inner.lock().await;
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    for instance in inner.instances.values() {
      if let Some(path) = &instance.profile_path {
        let instance_path = std::path::Path::new(path)
          .canonicalize()
          .unwrap_or_else(|_| std::path::Path::new(path).to_path_buf());
        if instance_path == target_path {
          return instance.cdp_port;
        }
      }
    }
    None
  }

  pub async fn find_chihua_by_profile(&self, profile_path: &str) -> Option<ChihuaLaunchResult> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut inner = self.inner.lock().await;

    // Canonicalize the target path for comparison
    let target_path = std::path::Path::new(profile_path)
      .canonicalize()
      .unwrap_or_else(|_| std::path::Path::new(profile_path).to_path_buf());

    // Find the instance with the matching profile path
    let mut found_id: Option<String> = None;
    for (id, instance) in &inner.instances {
      if let Some(path) = &instance.profile_path {
        let instance_path = std::path::Path::new(path)
          .canonicalize()
          .unwrap_or_else(|_| std::path::Path::new(path).to_path_buf());
        if instance_path == target_path {
          found_id = Some(id.clone());
          break;
        }
      }
    }

    // If we found an instance, verify the process is still running
    if let Some(id) = found_id {
      if let Some(instance) = inner.instances.get(&id) {
        if let Some(pid) = instance.process_id {
          let system = System::new_with_specifics(
            RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
          );
          let sysinfo_pid = sysinfo::Pid::from_u32(pid);

          if system.process(sysinfo_pid).is_some() {
            return Some(ChihuaLaunchResult {
              id: id.clone(),
              processId: instance.process_id,
              profilePath: instance.profile_path.clone(),
              url: instance.url.clone(),
              cdp_port: instance.cdp_port,
              used_fingerprint: None,
            });
          } else {
            log::info!(
              "Chihua process {} for profile {} is no longer running, cleaning up",
              pid,
              profile_path
            );
            inner.instances.remove(&id);
            return None;
          }
        }
      }
    }

    // If not found in in-memory instances, scan system processes.
    // This handles the case where the GUI was restarted but Chihua is still running.
    if let Some((pid, found_profile_path, cdp_port)) =
      Self::find_chihua_process_by_profile(&target_path)
    {
      log::info!(
        "Found running Chihua process (PID: {}) for profile path via system scan",
        pid
      );

      let instance_id = format!("recovered_{}", pid);
      inner.instances.insert(
        instance_id.clone(),
        ChihuaInstance {
          id: instance_id.clone(),
          process_id: Some(pid),
          profile_path: Some(found_profile_path.clone()),
          url: None,
          cdp_port,
        },
      );

      return Some(ChihuaLaunchResult {
        id: instance_id,
        processId: Some(pid),
        profilePath: Some(found_profile_path),
        url: None,
        cdp_port,
        used_fingerprint: None,
      });
    }

    None
  }

  /// Scan system processes to find a Chihua/Chromium process using a specific profile path
  fn find_chihua_process_by_profile(
    target_path: &std::path::Path,
  ) -> Option<(u32, String, Option<u16>)> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    let target_path_str = target_path.to_string_lossy();

    for (pid, process) in system.processes() {
      let cmd = process.cmd();
      if cmd.is_empty() {
        continue;
      }

      let exe_name = process.name().to_string_lossy().to_lowercase();
      let is_chromium_like = exe_name.contains("chihua")
        || exe_name.contains("chromium")
        || exe_name.contains("chrome");

      if !is_chromium_like {
        continue;
      }

      // Skip child processes (renderer, GPU, utility, zygote, etc.)
      // Only the main browser process lacks a --type= argument
      let is_child = cmd
        .iter()
        .any(|a| a.to_str().is_some_and(|s| s.starts_with("--type=")));
      if is_child {
        continue;
      }

      let mut matched = false;
      let mut cdp_port: Option<u16> = None;

      for arg in cmd.iter() {
        if let Some(arg_str) = arg.to_str() {
          if let Some(dir_val) = arg_str.strip_prefix("--user-data-dir=") {
            let cmd_path = std::path::Path::new(dir_val)
              .canonicalize()
              .unwrap_or_else(|_| std::path::Path::new(dir_val).to_path_buf());
            if cmd_path == target_path {
              matched = true;
            }
          }

          if let Some(port_val) = arg_str.strip_prefix("--remote-debugging-port=") {
            cdp_port = port_val.parse().ok();
          }
        }
      }

      if matched {
        return Some((pid.as_u32(), target_path_str.to_string(), cdp_port));
      }
    }

    None
  }

  #[allow(dead_code)]
  pub async fn launch_chihua_profile(
    &self,
    app_handle: &AppHandle,
    profile: &BrowserProfile,
    config: &ChihuaConfig,
    url: Option<&str>,
    proxy_url: Option<&str>,
  ) -> Result<ChihuaLaunchResult, Box<dyn std::error::Error + Send + Sync>> {
    let profiles_dir = self.get_profiles_dir();
    let profile_path = profiles_dir.join(profile.id.to_string()).join("profile");
    let profile_path_str = profile_path.to_string_lossy().to_string();

    std::fs::create_dir_all(&profile_path)?;

    if let Some(existing) = self.find_chihua_by_profile(&profile_path_str).await {
      log::info!("Stopping existing Chihua instance for profile");
      self.stop_chihua(&existing.id).await?;
    }

    self
      .launch_chihua(
        app_handle,
        profile,
        &profile_path_str,
        config,
        url,
        proxy_url,
        profile.ephemeral,
        &[],
        None,
        false,
      )
      .await
  }

  #[allow(dead_code)]
  pub async fn cleanup_dead_instances(&self) {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};

    let mut inner = self.inner.lock().await;
    let mut dead_ids = Vec::new();

    let system = System::new_with_specifics(
      RefreshKind::nothing().with_processes(ProcessRefreshKind::everything()),
    );

    for (id, instance) in &inner.instances {
      if let Some(pid) = instance.process_id {
        let pid = sysinfo::Pid::from_u32(pid);
        if !system.processes().contains_key(&pid) {
          dead_ids.push(id.clone());
        }
      }
    }

    for id in dead_ids {
      log::info!("Cleaning up dead Chihua instance: {id}");
      inner.instances.remove(&id);
    }
  }
}

lazy_static::lazy_static! {
  static ref CHIHUA_MANAGER: ChihuaManager = ChihuaManager::new();
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn window_size_prefers_outer_window_dimensions() {
    // Field names + values mirror a real Chihua fingerprint (camelCase).
    let fp = r#"{"windowOuterWidth": 1268, "windowOuterHeight": 764,
                 "windowInnerWidth": 1253, "windowInnerHeight": 630,
                 "screenAvailWidth": 1280, "screenAvailHeight": 775,
                 "screenWidth": 1280, "screenHeight": 800}"#;
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(fp),
      Some((1268, 764))
    );
  }

  #[test]
  fn window_size_falls_back_to_avail_then_full_screen() {
    let avail = r#"{"screenAvailWidth": 1280, "screenAvailHeight": 775,
                    "screenWidth": 1280, "screenHeight": 800}"#;
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(avail),
      Some((1280, 775))
    );

    let full = r#"{"screenWidth": 2560, "screenHeight": 1440}"#;
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(full),
      Some((2560, 1440))
    );
  }

  #[test]
  fn window_size_handles_wrapper_and_stringified_numbers() {
    let wrapped = r#"{"fingerprint": {"windowOuterWidth": "1366", "windowOuterHeight": "768"}}"#;
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(wrapped),
      Some((1366, 768))
    );
  }

  #[test]
  fn window_size_none_when_missing_or_invalid() {
    // No dimensions at all.
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(r#"{"userAgent": "x"}"#),
      None
    );
    // A width with no matching height is not a usable pair.
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(r#"{"windowOuterWidth": 1268}"#),
      None
    );
    // Zero is rejected as a degenerate size.
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint(
        r#"{"windowOuterWidth": 0, "windowOuterHeight": 0}"#
      ),
      None
    );
    // Not valid JSON.
    assert_eq!(
      ChihuaManager::window_size_from_fingerprint("not json"),
      None
    );
  }
}
