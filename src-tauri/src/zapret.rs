//! Обход блокировок без VPN (zapret) — переключатель для Windows. Всю работу делает zapretctl.exe из папки
//! zapret рядом с программой (собирается в CI из zapret/): одна копия в %ProgramData%\CloudVPN\zapret и служба
//! Windows, общие с Cloud VPN для Windows и Cloud Browser. Включение и выключение просят права администратора (UAC).

use serde_json::Value;

#[cfg(windows)]
fn zapretctl(args: &[&str]) -> Result<Value, String> {
  use std::os::windows::process::CommandExt;
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  let exe = std::env::current_exe().map_err(|e| e.to_string())?;
  let dir = exe.parent().ok_or("нет папки программы")?;
  let ctl = dir.join("zapret").join("zapretctl.exe");
  if !ctl.exists() {
    return Err("в этой сборке нет zapret".into());
  }
  let out = std::process::Command::new(&ctl)
    .args(args)
    .creation_flags(CREATE_NO_WINDOW)
    .output()
    .map_err(|e| format!("zapretctl: {e}"))?;
  let text = String::from_utf8_lossy(&out.stdout);
  let line = text
    .lines()
    .rev()
    .find(|l| l.trim_start().starts_with('{'))
    .unwrap_or("");
  serde_json::from_str(line).map_err(|_| format!("zapretctl: непонятный ответ ({})", text.trim()))
}

#[cfg(not(windows))]
fn zapretctl(_args: &[&str]) -> Result<Value, String> {
  Ok(
    serde_json::json!({ "ok": false, "error": "zapret есть только в Windows", "status": { "supported": false, "state": "off" } }),
  )
}

/// Состояние: {"ok":…, "error":…, "status":{"supported","running","state","preset","presets",…}}.
#[tauri::command]
pub async fn zapret_status() -> Result<Value, String> {
  tokio::task::spawn_blocking(|| zapretctl(&["status"]))
    .await
    .map_err(|e| e.to_string())?
}

/// Включить (со стратегией preset или прежней) или выключить. Ответ — как у zapret_status, с ошибкой в "error".
#[tauri::command]
pub async fn zapret_set(on: bool, preset: Option<String>) -> Result<Value, String> {
  tokio::task::spawn_blocking(move || {
    let mut args: Vec<String> = vec![if on { "start" } else { "stop" }.to_string()];
    if on {
      if let Some(p) = preset.filter(|p| !p.is_empty()) {
        args.push("--preset".into());
        args.push(p);
      }
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    zapretctl(&refs)
  })
  .await
  .map_err(|e| e.to_string())?
}
