//! Наши сервисы внутри окна Chihua (модули в левом меню): кабинет, почта и другие веб-сервисы открываются
//! дочерним WebView поверх области страницы — в том же окне, без новых окон. Между переключениями модуль
//! остаётся живым (скрывается, а не закрывается). Программы без веб-версии (мессенджер, соцсеть, кошелёк)
//! находятся на компьютере и запускаются отсюда же, иначе — ссылки на установку.
//!
//! У дочерних WebView нет доступа к командам Chihua: права (capabilities) выданы только окну "main".

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, WebviewBuilder, WebviewUrl};

const PREFIX: &str = "svc-";
// Внутри модуля открываются только наши адреса; остальное — в обычном браузере системы
const INSIDE_HOSTS: [&str; 4] = ["cabinet.zjd.uk", "cabinet.0nn.us", "mail.zjd.uk", "oauth.telegram.org"];

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bounds {
  x: f64,
  y: f64,
  width: f64,
  height: f64,
}

fn label(id: &str) -> Result<String, String> {
  if id.is_empty() || id.len() > 32 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
    return Err("неверный модуль".into());
  }
  Ok(format!("{PREFIX}{id}"))
}

fn inside(url: &tauri::Url) -> bool {
  match url.scheme() {
    "about" | "data" | "blob" => true,
    "https" => url.host_str().map(|h| INSIDE_HOSTS.contains(&h)).unwrap_or(false),
    _ => false,
  }
}

/// Кабинет в модуле: один раз кладём вход Chihua (refresh_token), если кабинет ещё не вошёл; метка не возвращает
/// вход после выхода из аккаунта в самом кабинете. Так же делают Cloud VPN для Windows и расширение.
fn seed_script(token: Option<String>) -> String {
  let Some(token) = token else { return String::new() };
  use sha2::{Digest, Sha256};
  let sum = Sha256::digest(token.as_bytes());
  let mark = format!("cvpn_seed_chihua_{}", sum[..6].iter().map(|b| format!("{b:02x}")).collect::<String>());
  let tok = serde_json::to_string(&token).unwrap_or_default();
  let mark = serde_json::to_string(&mark).unwrap_or_default();
  format!(
    "(() => {{ if (!['cabinet.zjd.uk', 'cabinet.0nn.us'].includes(location.hostname) || window.top !== window) return; \
     try {{ const m = {mark}; if (!localStorage.getItem(m)) {{ if (!localStorage.getItem('refresh_token')) localStorage.setItem('refresh_token', {tok}); localStorage.setItem(m, '1'); }} }} catch (e) {{}} }})();"
  )
}

fn hide_all<R: Runtime>(app: &AppHandle<R>, except: Option<&str>) {
  for (l, wv) in app.webviews() {
    if l.starts_with(PREFIX) && Some(l.as_str()) != except {
      let _ = wv.hide();
    }
  }
}

/// Показать модуль в прямоугольнике страницы (координаты CSS = логические пиксели окна).
#[tauri::command]
pub async fn service_view_show<R: Runtime>(app: AppHandle<R>, id: String, url: String, bounds: Bounds) -> Result<(), String> {
  let label = label(&id)?;
  let target = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
  if !inside(&target) || target.scheme() != "https" {
    return Err("этот адрес не открывается внутри Chihua".into());
  }
  hide_all(&app, Some(&label));
  let pos = LogicalPosition::new(bounds.x, bounds.y);
  let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
  if let Some(wv) = app.get_webview(&label) {
    wv.set_position(pos).map_err(|e| e.to_string())?;
    wv.set_size(size).map_err(|e| e.to_string())?;
    wv.show().map_err(|e| e.to_string())?;
    return Ok(());
  }
  let window = app.get_window("main").ok_or("нет главного окна")?;
  let opener = app.clone();
  let builder = WebviewBuilder::new(&label, WebviewUrl::External(target))
    .initialization_script(&seed_script(crate::cloudvpn::session_refresh_token()))
    .on_navigation(move |u| {
      if inside(u) {
        return true;
      }
      // оплата, t.me, чужие сайты — в браузере системы
      if matches!(u.scheme(), "https" | "http" | "tg" | "mailto") {
        use tauri_plugin_opener::OpenerExt;
        let _ = opener.opener().open_url(u.as_str(), None::<&str>);
      }
      false
    });
  window.add_child(builder, pos, size).map_err(|e| e.to_string())?;
  Ok(())
}

/// Новый прямоугольник модуля (окно поменяло размер).
#[tauri::command]
pub async fn service_view_bounds<R: Runtime>(app: AppHandle<R>, id: String, bounds: Bounds) -> Result<(), String> {
  if let Some(wv) = app.get_webview(&label(&id)?) {
    wv.set_position(LogicalPosition::new(bounds.x, bounds.y)).map_err(|e| e.to_string())?;
    wv.set_size(LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0))).map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Спрятать все модули (ушли на другую страницу или открылся диалог).
#[tauri::command]
pub async fn service_view_hide<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
  hide_all(&app, None);
  Ok(())
}

/// Тема программы — открытым модулям (наши страницы понимают CvTheme.follow; чужого имени темы не передаём).
#[tauri::command]
pub async fn service_view_theme<R: Runtime>(app: AppHandle<R>, theme: String) -> Result<(), String> {
  if !matches!(theme.as_str(), "dark" | "light" | "vice-night" | "vice-day") {
    return Err("неизвестная тема".into());
  }
  for (name, wv) in app.webviews() {
    if name.starts_with(PREFIX) {
      let _ = wv.eval(format!("window.CvTheme&&CvTheme.follow('{theme}')"));
    }
  }
  Ok(())
}

/// Назад по истории модуля.
#[tauri::command]
pub async fn service_view_back<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
  if let Some(wv) = app.get_webview(&label(&id)?) {
    wv.eval("history.back()").map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Перезагрузить модуль или вернуть его на адрес url.
#[tauri::command]
pub async fn service_view_reload<R: Runtime>(app: AppHandle<R>, id: String, url: Option<String>) -> Result<(), String> {
  if let Some(wv) = app.get_webview(&label(&id)?) {
    match url.as_deref().map(tauri::Url::parse) {
      Some(Ok(u)) if inside(&u) => wv.navigate(u).map_err(|e| e.to_string())?,
      _ => wv.reload().map_err(|e| e.to_string())?,
    }
  }
  Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
  id: &'static str,
  name: &'static str,
  installed: bool,
  version: Option<String>,
}

// id совпадает с модулями фронтенда; key — ключ удаления в «Программах и компонентах»
const KNOWN: [(&str, &str, &str, &str); 6] = [
  ("vpn", "Cloud VPN", "CloudVPN", "CloudVPN.exe"),
  ("messenger", "Cloud Messenger", "CloudMessenger", "CloudMessenger.exe"),
  ("social", "Cloud Social", "CloudSocial", "CloudSocial.exe"),
  ("wallet", "Cloud Wallet", "CloudWallet", "CloudWallet.exe"),
  ("mail", "Cloud Mail", "CloudMail", "CloudMail.exe"),
  ("zapret", "Cloud Zapret", "CloudZapret", "CloudZapret.exe"),
];

#[cfg(target_os = "windows")]
fn find(key: &str, name: &str, exe: &str) -> Option<(std::path::PathBuf, Option<String>)> {
  use winreg::enums::*;
  use winreg::RegKey;
  let path = format!("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{key}");
  let roots = [
    (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY),
    (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY),
    (HKEY_CURRENT_USER, KEY_READ),
  ];
  for (root, flags) in roots {
    let Ok(k) = RegKey::predef(root).open_subkey_with_flags(&path, flags) else { continue };
    let icon: String = k.get_value("DisplayIcon").unwrap_or_default();
    let loc: String = k.get_value("InstallLocation").unwrap_or_default();
    let ver: Option<String> = k.get_value("DisplayVersion").ok();
    let icon = icon.trim_end_matches(",0").trim_matches(|c| c == '"' || c == ' ').to_string();
    let mut p = std::path::PathBuf::from(&icon);
    let matches = p.file_name().map(|f| f.to_string_lossy().eq_ignore_ascii_case(exe)).unwrap_or(false);
    if !matches && !loc.is_empty() {
      p = std::path::PathBuf::from(loc).join(exe);
    }
    if p.is_file() {
      return Some((p, ver));
    }
  }
  for base in [std::env::var("ProgramFiles").ok(), std::env::var("LOCALAPPDATA").ok().map(|d| format!("{d}\\Programs"))]
    .into_iter()
    .flatten()
  {
    let p = std::path::PathBuf::from(base).join(name).join(exe);
    if p.is_file() {
      return Some((p, None));
    }
  }
  None
}

#[cfg(not(target_os = "windows"))]
fn find(_key: &str, _name: &str, _exe: &str) -> Option<(std::path::PathBuf, Option<String>)> {
  None
}

/// Наши программы и установлены ли они на этом компьютере.
#[tauri::command]
pub async fn services_apps() -> Result<Vec<AppInfo>, String> {
  Ok(
    KNOWN
      .iter()
      .map(|(id, name, key, exe)| {
        let found = find(key, name, exe);
        AppInfo { id, name, installed: found.is_some(), version: found.and_then(|f| f.1) }
      })
      .collect(),
  )
}

/// Запустить нашу программу (у всех один экземпляр: запущенная просто покажет окно).
#[tauri::command]
pub async fn services_open_app(id: String) -> Result<(), String> {
  let (_, name, key, exe) = KNOWN.iter().find(|k| k.0 == id).ok_or("неизвестная программа")?;
  let (path, _) = find(key, name, exe).ok_or_else(|| format!("{name} не установлен"))?;
  let mut cmd = std::process::Command::new(&path);
  if let Some(dir) = path.parent() {
    cmd.current_dir(dir);
  }
  cmd.spawn().map(|_| ()).map_err(|e| format!("{name}: {e}"))
}

/// Список загрузок (downloads.json: GitHub, РУ Зеркало, наш сервер) — для модулей без веб-версии.
#[tauri::command]
pub async fn services_downloads() -> Result<serde_json::Value, String> {
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(20))
    .build()
    .map_err(|e| e.to_string())?;
  for base in ["https://cabinet.zjd.uk", "https://cabinet.0nn.us"] {
    let Ok(resp) = client.get(format!("{base}/app/downloads.json")).send().await else { continue };
    if !resp.status().is_success() {
      continue;
    }
    if let Ok(v) = resp.json::<serde_json::Value>().await {
      return Ok(v.get("products").cloned().unwrap_or(serde_json::Value::Null));
    }
  }
  Err("список загрузок недоступен".into())
}
