//! Линия установки: Chihua Browser или Vice Antidetect (Vice; продукт miami, прежнее имя — Miami Browser).
//! Программа одна; установщик Vice Antidetect кладёт рядом с программой brand.json —
//! {"v":1,"brand":"vice","name":"Vice Antidetect","theme":"vice-night"} (общий формат установщиков CloudVPN).
//! Это тема по умолчанию; потом линия идёт за темой, которую человек выбрал в настройках:
//! Vice-темы — Vice Antidetect, остальные — Chihua Browser (заголовок окна, значок окна и трея).

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct BrandInfo {
  pub line: String,
  pub theme: String,
  pub name: String,
}

pub fn name_of(line: &str) -> &'static str {
  if line == "vice" {
    "Vice Antidetect"
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
  let vice = line == "vice";
  if let Some(w) = app.get_webview_window("main") {
    w.set_title(name).map_err(|e| e.to_string())?;
    // значок окна (панель задач): Vice Antidetect — малый значок хамелеона, иначе — значок программы
    let icon = if vice {
      tauri::image::Image::from_bytes(MIAMI_ICON).ok()
    } else {
      app.default_window_icon().cloned()
    };
    if let Some(icon) = icon {
      let _ = w.set_icon(icon);
    }
    // панель задач рисует большой значок окна, а set_icon ставит только малый
    #[cfg(target_os = "windows")]
    if let (Ok(hwnd), Ok(exe)) = (w.hwnd(), std::env::current_exe()) {
      let ico = if vice { vice_ico(&app, &exe) } else { None };
      crate::taskbar::set(hwnd.0 as isize, name, &exe, ico.as_deref());
    }
  }
  if let Some(t) = app.tray_by_id("main") {
    let _ = t.set_tooltip(Some(name));
    if vice {
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

/// Значки линии Vice Antidetect (набор дизайна Cloud VPN, appicon/vice/miami — рисунок владельца). Окну — малый
/// вариант (до 96 px: голова, «VICE», знак сервиса): на панели задач он читается лучше полного рисунка.
const MIAMI_ICON: &[u8] = include_bytes!("../windows/miami/miami-96.png");
const MIAMI_TRAY: &[u8] = include_bytes!("../windows/miami/miami-32.png");
/// Значок панели задач: .ico рядом с программой (его кладёт установщик Vice Antidetect); Vice-тема в установке
/// Chihua — своя копия в папке данных.
#[cfg(target_os = "windows")]
fn vice_ico(app: &tauri::AppHandle, exe: &std::path::Path) -> Option<std::path::PathBuf> {
  use tauri::Manager;
  let near = exe.parent()?.join("miami.ico");
  if near.is_file() {
    return Some(near);
  }
  let dir = app.path().app_local_data_dir().ok()?.join("icons");
  let file = dir.join("vice-antidetect.ico");
  let same = std::fs::metadata(&file).is_ok_and(|m| m.len() == MIAMI_ICO.len() as u64);
  if !same {
    std::fs::create_dir_all(&dir).ok()?;
    std::fs::write(&file, MIAMI_ICO).ok()?;
  }
  Some(file)
}
#[cfg(target_os = "windows")]
const MIAMI_ICO: &[u8] = include_bytes!("../windows/miami/miami.ico");

/// Значок в трее линии Chihua (тот же, что при запуске).
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon-linux-44.png");

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn names() {
    assert_eq!(name_of("vice"), "Vice Antidetect");
    assert_eq!(name_of("cloud"), "Chihua Browser");
    // рядом с тестовым exe brand.json нет — линия Chihua
    assert_eq!(read().line, "cloud");
  }
}
