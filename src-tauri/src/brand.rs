//! Линия установки: Chihua Browser или Miami Browser (Vice). Программа одна; Miami-установщик кладёт рядом с
//! программой brand.json — {"v":1,"brand":"vice","name":"Miami Browser","theme":"vice-night"} (общий формат
//! установщиков CloudVPN). Это тема по умолчанию; потом линия идёт за темой, которую человек выбрал в настройках:
//! Vice-темы — Miami Browser, остальные — Chihua Browser (заголовок окна, подсказка значка в трее).

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct BrandInfo {
  pub line: String,
  pub theme: String,
  pub name: String,
}

pub fn name_of(line: &str) -> &'static str {
  if line == "vice" {
    "Miami Browser"
  } else {
    "Chihua Browser"
  }
}

/// brand.json рядом с программой; без файла — Chihua.
pub fn read() -> BrandInfo {
  let mut line = "cloud".to_string();
  let mut theme = String::new();
  let dir = std::env::current_exe()
    .ok()
    .and_then(|p| p.parent().map(|d| d.to_path_buf()));
  if let Some(dir) = dir {
    if let Ok(raw) = std::fs::read_to_string(dir.join("brand.json")) {
      if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw.trim_start_matches('\u{feff}')) {
        let b = v
          .get("brand")
          .or_else(|| v.get("line"))
          .and_then(|x| x.as_str())
          .unwrap_or("");
        if b == "vice" {
          line = "vice".into();
        }
        if let Some(t) = v.get("theme").and_then(|x| x.as_str()) {
          if matches!(t, "vice-night" | "vice-day" | "dark" | "light" | "system") {
            theme = t.into();
          }
        }
      }
    }
  }
  let name = name_of(&line).to_string();
  BrandInfo { line, theme, name }
}

#[tauri::command]
pub fn get_brand() -> BrandInfo {
  read()
}

/// Тема сменила линию: заголовок окна и подсказка значка в трее.
#[tauri::command]
pub fn apply_line(app: tauri::AppHandle, line: String) -> Result<(), String> {
  use tauri::Manager;
  let name = name_of(&line);
  let miami = line == "vice";
  if let Some(w) = app.get_webview_window("main") {
    w.set_title(name).map_err(|e| e.to_string())?;
    // значок окна (панель задач): Miami — чихуахуа в очках, иначе — значок программы
    let icon = if miami {
      tauri::image::Image::from_bytes(MIAMI_ICON).ok()
    } else {
      app.default_window_icon().cloned()
    };
    if let Some(icon) = icon {
      let _ = w.set_icon(icon);
    }
  }
  if let Some(t) = app.tray_by_id("main") {
    let _ = t.set_tooltip(Some(name));
    if miami {
      if let Ok(icon) = tauri::image::Image::from_bytes(MIAMI_TRAY) {
        let _ = t.set_icon(Some(icon));
      }
    } else if let Ok(img) = image::load_from_memory(TRAY_ICON) {
      let rgba = img.into_rgba8();
      let (w, h) = rgba.dimensions();
      let _ = t.set_icon(Some(tauri::image::Image::new_owned(rgba.into_raw(), w, h)));
    }
  }
  Ok(())
}

/// Значки линии Miami (набор дизайна Cloud VPN, appicon/vice/miami — свой рисунок).
const MIAMI_ICON: &[u8] = include_bytes!("../windows/miami/miami-256.png");
const MIAMI_TRAY: &[u8] = include_bytes!("../windows/miami/miami-32.png");
/// Значок в трее линии Chihua (тот же, что при запуске).
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon-linux-44.png");

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names() {
    assert_eq!(name_of("vice"), "Miami Browser");
    assert_eq!(name_of("cloud"), "Chihua Browser");
    // рядом с тестовым exe brand.json нет — линия Chihua
    assert_eq!(read().line, "cloud");
  }
}
