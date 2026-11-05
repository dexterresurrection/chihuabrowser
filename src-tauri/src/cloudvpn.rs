//! Cloud VPN account inside the browser: sign in, and the servers of the subscription become proxies a profile can use.
//! Each server runs on demand: chihua-tunnel starts xray with a local SOCKS5 port on 127.0.0.1.
use crate::browser::ProxySettings;
use crate::proxy_manager::PROXY_MANAGER;
use crate::settings_manager::SettingsManager;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command as TokioCommand};
use tokio::sync::Mutex as AsyncMutex;

const API_BASES: [&str; 2] = ["https://cabinet.zjd.uk/api", "https://cabinet.0nn.us/api"];
const PROXY_ID_PREFIX: &str = "cloudvpn-";
const SESSION_FILE: &str = "cloudvpn_session.dat";
const SERVERS_FILE: &str = "cloudvpn_servers.dat";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Session {
  email: String,
  access_token: String,
  refresh_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedServer {
  proxy_id: String,
  name: String,
  protocol: String,
  link: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudVpnServer {
  pub proxy_id: String,
  pub name: String,
  pub protocol: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CloudVpnStatus {
  pub logged_in: bool,
  pub email: Option<String>,
  pub subscription_active: Option<bool>,
  pub subscription_end: Option<String>,
  pub servers: Vec<CloudVpnServer>,
}

lazy_static::lazy_static! {
  static ref TUNNELS: AsyncMutex<HashMap<String, Child>> = AsyncMutex::new(HashMap::new());
}

pub fn is_cloudvpn_proxy(proxy_id: &str) -> bool {
  proxy_id.starts_with(PROXY_ID_PREFIX)
}

fn path(name: &str) -> std::path::PathBuf {
  SettingsManager::instance().get_settings_dir().join(name)
}

fn load<T: for<'de> Deserialize<'de>>(name: &str) -> Option<T> {
  let data = std::fs::read(path(name)).ok()?;
  let plain = SettingsManager::instance().vault_decrypt(&data).ok()?;
  serde_json::from_slice(&plain).ok()
}

fn save<T: Serialize>(name: &str, value: &T) -> Result<(), String> {
  let plain = serde_json::to_vec(value).map_err(|e| e.to_string())?;
  let data = SettingsManager::instance().vault_encrypt(&plain)?;
  let file = path(name);
  if let Some(parent) = file.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  std::fs::write(file, data).map_err(|e| e.to_string())
}

fn http() -> reqwest::Client {
  reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(25))
    .connect_timeout(std::time::Duration::from_secs(8))
    .user_agent("ChihuaBrowser")
    .build()
    .unwrap_or_default()
}

/// One API call, trying the second address if the first does not answer at all. Returns status and JSON body.
async fn call(
  method: reqwest::Method,
  path: &str,
  token: Option<&str>,
  body: Option<serde_json::Value>,
) -> Result<(u16, serde_json::Value), String> {
  let client = http();
  let mut last = String::new();
  for base in API_BASES {
    let mut req = client.request(method.clone(), format!("{base}{path}"));
    if let Some(token) = token {
      req = req.bearer_auth(token);
    }
    if let Some(body) = &body {
      req = req.json(body);
    }
    match req.send().await {
      Ok(resp) => {
        let status = resp.status().as_u16();
        let value = resp.json::<serde_json::Value>().await.unwrap_or(json!({}));
        return Ok((status, value));
      }
      Err(e) => last = e.to_string(),
    }
  }
  Err(format!("Кабинет не отвечает: {last}"))
}

fn detail(value: &serde_json::Value, fallback: &str) -> String {
  match value.get("detail") {
    Some(serde_json::Value::String(s)) => s.clone(),
    Some(other) => other.get("message").and_then(|m| m.as_str()).unwrap_or(fallback).to_string(),
    None => fallback.to_string(),
  }
}

fn store_tokens(email: &str, value: &serde_json::Value) -> Result<(), String> {
  let access = value.get("access_token").and_then(|v| v.as_str()).ok_or("В ответе нет токена")?;
  let refresh = value.get("refresh_token").and_then(|v| v.as_str()).unwrap_or("");
  save(
    SESSION_FILE,
    &Session { email: email.to_string(), access_token: access.to_string(), refresh_token: refresh.to_string() },
  )
}

#[tauri::command]
pub async fn cloudvpn_request_code(email: String) -> Result<(), String> {
  let (status, value) = call(reqwest::Method::POST, "/cabinet/auth/email/otp/request", None, Some(json!({ "email": email }))).await?;
  if status >= 400 {
    return Err(detail(&value, "Код не отправлен"));
  }
  Ok(())
}

#[tauri::command]
pub async fn cloudvpn_verify_code(email: String, code: String, accepted: Option<Vec<String>>) -> Result<(), String> {
  let mut body = json!({ "email": email, "code": code });
  if let Some(accepted) = accepted {
    body["accepted_legal_documents"] = json!(accepted);
  }
  let (status, value) = call(reqwest::Method::POST, "/cabinet/auth/email/otp/verify", None, Some(body)).await?;
  if status == 428 {
    return Err("LEGAL_CONSENT_REQUIRED".to_string());
  }
  if status >= 400 {
    return Err(detail(&value, "Неверный код"));
  }
  store_tokens(&email, &value)
}

#[tauri::command]
pub async fn cloudvpn_login_password(email: String, password: String) -> Result<(), String> {
  let (status, value) = call(reqwest::Method::POST, "/cabinet/auth/email/login", None, Some(json!({ "email": email, "password": password }))).await?;
  if status >= 400 {
    return Err(detail(&value, "Неверный логин или пароль"));
  }
  store_tokens(&email, &value)
}

/// An API call as the signed-in user; refreshes the short-lived token once on 401.
async fn authed(path: &str) -> Result<serde_json::Value, String> {
  let mut session: Session = load(SESSION_FILE).ok_or("Войдите в аккаунт Cloud VPN")?;
  let (status, value) = call(reqwest::Method::GET, path, Some(&session.access_token), None).await?;
  if status != 401 {
    return if status >= 400 { Err(detail(&value, "Ошибка кабинета")) } else { Ok(value) };
  }
  let (status, value) = call(reqwest::Method::POST, "/cabinet/auth/refresh", None, Some(json!({ "refresh_token": session.refresh_token }))).await?;
  if status >= 400 {
    let _ = std::fs::remove_file(self::path(SESSION_FILE));
    return Err("Сеанс истёк, войдите снова".to_string());
  }
  session.access_token = value.get("access_token").and_then(|v| v.as_str()).unwrap_or("").to_string();
  save(SESSION_FILE, &session)?;
  let (status, value) = call(reqwest::Method::GET, path, Some(&session.access_token), None).await?;
  if status >= 400 {
    return Err(detail(&value, "Ошибка кабинета"));
  }
  Ok(value)
}

fn saved_servers() -> Vec<SavedServer> {
  load(SERVERS_FILE).unwrap_or_default()
}

#[tauri::command]
pub async fn cloudvpn_status() -> Result<CloudVpnStatus, String> {
  let session: Option<Session> = load(SESSION_FILE);
  let servers = saved_servers()
    .into_iter()
    .map(|s| CloudVpnServer { proxy_id: s.proxy_id, name: s.name, protocol: s.protocol })
    .collect();
  let Some(session) = session else {
    return Ok(CloudVpnStatus { logged_in: false, email: None, subscription_active: None, subscription_end: None, servers });
  };
  let sub = authed("/cabinet/subscription").await.ok();
  let info = sub.as_ref().and_then(|v| v.get("subscription"));
  Ok(CloudVpnStatus {
    logged_in: true,
    email: Some(session.email),
    subscription_active: info.and_then(|s| s.get("is_active")).and_then(|v| v.as_bool()),
    subscription_end: info.and_then(|s| s.get("end_date")).and_then(|v| v.as_str()).map(str::to_string),
    servers,
  })
}

/// A stable local port per server, so a profile keeps working between launches.
fn port_for(proxy_id: &str) -> u16 {
  let hash = proxy_id.bytes().fold(2166136261u32, |h, b| (h ^ b as u32).wrapping_mul(16777619));
  20000 + (hash % 25000) as u16
}

fn stable_id(link: &str) -> String {
  // the address part of the link identifies the server; its name may change
  let key = link.split('#').next().unwrap_or(link);
  let hash = key.bytes().fold(14695981039346656037u64, |h, b| (h ^ b as u64).wrapping_mul(1099511628211));
  format!("{PROXY_ID_PREFIX}{hash:016x}")
}

async fn run_sidecar(args: &[&str], stdin_text: &str) -> Result<Vec<u8>, String> {
  let exe = crate::proxy_runner::find_sidecar_executable("chihua-tunnel").map_err(|e| e.to_string())?;
  let mut cmd = TokioCommand::new(exe);
  cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  hide_window(&mut cmd);
  let mut child = cmd.spawn().map_err(|e| e.to_string())?;
  if let Some(mut stdin) = child.stdin.take() {
    stdin.write_all(stdin_text.as_bytes()).await.map_err(|e| e.to_string())?;
  }
  let out = child.wait_with_output().await.map_err(|e| e.to_string())?;
  if !out.status.success() {
    return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
  }
  Ok(out.stdout)
}

#[cfg(windows)]
fn hide_window(cmd: &mut TokioCommand) {
  cmd.creation_flags(0x08000000);
}

#[cfg(not(windows))]
fn hide_window(_cmd: &mut TokioCommand) {}

/// Reads the subscription and makes each server a proxy. A server that left the subscription is removed.
#[tauri::command]
pub async fn cloudvpn_sync_servers() -> Result<Vec<CloudVpnServer>, String> {
  let sub = authed("/cabinet/subscription").await?;
  let url = sub
    .get("subscription")
    .and_then(|s| s.get("subscription_url"))
    .and_then(|v| v.as_str())
    .ok_or("Нет активной подписки")?
    .to_string();
  let body = http().get(&url).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
  let listed = run_sidecar(&["list"], &body).await?;

  #[derive(Deserialize)]
  struct Listed {
    name: String,
    protocol: String,
    link: String,
  }
  let listed: Vec<Listed> = serde_json::from_slice(&listed).map_err(|e| e.to_string())?;
  let servers: Vec<SavedServer> = listed
    .into_iter()
    .filter(|s| !s.link.is_empty())
    .map(|s| SavedServer { proxy_id: stable_id(&s.link), name: s.name, protocol: s.protocol, link: s.link })
    .collect();

  let keep: Vec<(String, String, ProxySettings)> = servers
    .iter()
    .map(|s| {
      (
        s.proxy_id.clone(),
        format!("Cloud VPN · {}", s.name),
        ProxySettings {
          proxy_type: "socks5".to_string(),
          host: "127.0.0.1".to_string(),
          port: port_for(&s.proxy_id),
          username: None,
          password: None,
        },
      )
    })
    .collect();
  PROXY_MANAGER.replace_managed_proxies(PROXY_ID_PREFIX, keep);
  save(SERVERS_FILE, &servers)?;
  Ok(servers.into_iter().map(|s| CloudVpnServer { proxy_id: s.proxy_id, name: s.name, protocol: s.protocol }).collect())
}

/// Starts the tunnel of a Cloud VPN proxy if it is not running yet.
pub async fn ensure_tunnel(proxy_id: &str) -> Result<(), String> {
  let mut tunnels = TUNNELS.lock().await;
  if let Some(child) = tunnels.get_mut(proxy_id) {
    if matches!(child.try_wait(), Ok(None)) {
      return Ok(());
    }
    tunnels.remove(proxy_id);
  }
  let server = saved_servers()
    .into_iter()
    .find(|s| s.proxy_id == proxy_id)
    .ok_or("Сервера больше нет в подписке, обновите список на странице Cloud VPN")?;
  let exe = crate::proxy_runner::find_sidecar_executable("chihua-tunnel").map_err(|e| e.to_string())?;
  let xray = crate::proxy_runner::find_sidecar_executable("xray").map_err(|e| e.to_string())?;
  let port = port_for(proxy_id).to_string();
  let mut cmd = TokioCommand::new(exe);
  cmd
    .arg("run")
    .arg("--xray")
    .arg(xray)
    .arg("--port")
    .arg(&port)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
  hide_window(&mut cmd);
  let mut child = cmd.spawn().map_err(|e| format!("Туннель не запустился: {e}"))?;
  let mut stdin = child.stdin.take().ok_or("no stdin")?;
  stdin.write_all(format!("{}\n", server.link).as_bytes()).await.map_err(|e| e.to_string())?;
  let stdout = child.stdout.take().ok_or("no stdout")?;
  let mut lines = BufReader::new(stdout).lines();
  let ready = tokio::time::timeout(std::time::Duration::from_secs(35), lines.next_line()).await;
  match ready {
    Ok(Ok(Some(line))) if line.trim() == "ready" => {}
    _ => {
      let _ = child.kill().await;
      let mut message = String::new();
      if let Some(stderr) = child.stderr.take() {
        let mut err = BufReader::new(stderr).lines();
        while let Ok(Ok(Some(line))) = tokio::time::timeout(std::time::Duration::from_millis(300), err.next_line()).await {
          message.push_str(&line);
          message.push(' ');
        }
      }
      return Err(format!("Туннель не поднялся: {}", message.trim()));
    }
  }
  // держим stdin открытым: туннель живёт, пока жив браузер
  std::mem::forget(stdin);
  tunnels.insert(proxy_id.to_string(), child);
  Ok(())
}

#[tauri::command]
pub async fn cloudvpn_logout() -> Result<(), String> {
  let _ = std::fs::remove_file(path(SESSION_FILE));
  let _ = std::fs::remove_file(path(SERVERS_FILE));
  PROXY_MANAGER.replace_managed_proxies(PROXY_ID_PREFIX, Vec::new());
  TUNNELS.lock().await.clear();
  Ok(())
}
