//! Значок и имя окна на панели задач Windows.
//!
//! tauri ставит окну только малый значок; кнопку на панели задач рисует большой (ICON_BIG), и без него там остаётся
//! значок exe — у Vice Antidetect это была Chihua. Здесь окну ставятся оба значка из .ico (или из самого exe) и
//! свойства AppUserModel: имя и значок, с которыми окно закрепляется на панели задач.
//! AppUserModelID — идентификатор программы, тот же, что у ярлыков установщика.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

pub const APP_ID: &str = "com.chihuabrowser";

#[repr(C)]
struct Guid(u32, u16, u16, [u8; 8]);

#[repr(C)]
struct PropertyKey {
  fmtid: Guid,
  pid: u32,
}

// PROPVARIANT на x64: 8 байт заголовка и 16 байт значения
#[repr(C)]
struct PropVariant {
  vt: u16,
  reserved: [u16; 3],
  value: *const c_void,
  pad: usize,
}

const VT_LPWSTR: u16 = 31;
const IID_PROPERTY_STORE: Guid = Guid(
  0x886D_8EEB,
  0x8CF2,
  0x4446,
  [0x8D, 0x02, 0xCD, 0xBA, 0x1D, 0xBD, 0xCF, 0x99],
);

// PKEY_AppUserModel_*
const fn key(pid: u32) -> PropertyKey {
  PropertyKey {
    fmtid: Guid(
      0x9F4C_2855,
      0x9F79,
      0x4B39,
      [0xA8, 0xD0, 0xE1, 0xD4, 0x2D, 0xE1, 0xD5, 0xF3],
    ),
    pid,
  }
}
const RELAUNCH_COMMAND: u32 = 2;
const RELAUNCH_ICON: u32 = 3;
const RELAUNCH_NAME: u32 = 4;
const ID: u32 = 5;

const WM_SETICON: u32 = 0x0080;
const ICON_SMALL: usize = 0;
const ICON_BIG: usize = 1;
const IMAGE_ICON: u32 = 1;
const LR_LOADFROMFILE: u32 = 0x10;
const SM_CXICON: i32 = 11;
const SM_CXSMICON: i32 = 49;
const SMTO_ABORTIFHUNG: u32 = 2;

#[link(name = "shell32")]
extern "system" {
  fn SHGetPropertyStoreForWindow(hwnd: isize, riid: *const Guid, out: *mut *mut c_void) -> i32;
  fn ExtractIconExW(
    file: *const u16,
    index: i32,
    large: *mut isize,
    small: *mut isize,
    n: u32,
  ) -> u32;
}
#[link(name = "user32")]
extern "system" {
  fn LoadImageW(inst: isize, name: *const u16, kind: u32, cx: i32, cy: i32, flags: u32) -> isize;
  fn GetSystemMetrics(index: i32) -> i32;
  fn SendMessageTimeoutW(
    hwnd: isize,
    msg: u32,
    wparam: usize,
    lparam: isize,
    flags: u32,
    timeout: u32,
    result: *mut usize,
  ) -> isize;
}

fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
  s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

fn set_icon(hwnd: isize, which: usize, icon: isize) {
  if icon == 0 {
    return;
  }
  let mut res = 0usize;
  unsafe {
    SendMessageTimeoutW(
      hwnd,
      WM_SETICON,
      which,
      icon,
      SMTO_ABORTIFHUNG,
      500,
      &mut res,
    );
  }
}

fn load_ico(file: &Path, metric: i32) -> isize {
  let path = wide(file);
  unsafe {
    let size = GetSystemMetrics(metric);
    LoadImageW(0, path.as_ptr(), IMAGE_ICON, size, size, LR_LOADFROMFILE)
  }
}

/// Значки окна и свойства панели задач. icon — .ico линии; None — значок самой программы (exe).
pub fn apply(hwnd: isize, name: &str, exe: &Path, icon: Option<&Path>) {
  let (mut big, mut small) = match icon {
    Some(f) => (load_ico(f, SM_CXICON), load_ico(f, SM_CXSMICON)),
    None => (0, 0),
  };
  if big == 0 {
    let path = wide(exe);
    unsafe { ExtractIconExW(path.as_ptr(), 0, &mut big, &mut small, 1) };
  }
  set_icon(hwnd, ICON_SMALL, small);
  set_icon(hwnd, ICON_BIG, big);

  let mut store: *mut c_void = std::ptr::null_mut();
  let hr = unsafe { SHGetPropertyStoreForWindow(hwnd, &IID_PROPERTY_STORE, &mut store) };
  if hr != 0 || store.is_null() {
    log::warn!("taskbar: SHGetPropertyStoreForWindow {hr:#x}");
    return;
  }
  // IPropertyStore: 0–2 IUnknown, 3 GetCount, 4 GetAt, 5 GetValue, 6 SetValue, 7 Commit
  type SetValue =
    unsafe extern "system" fn(*mut c_void, *const PropertyKey, *const PropVariant) -> i32;
  type Plain = unsafe extern "system" fn(*mut c_void) -> i32;
  unsafe {
    let vtbl = *(store as *const *const *const c_void);
    let set_value: SetValue = std::mem::transmute(*vtbl.add(6));
    let commit: Plain = std::mem::transmute(*vtbl.add(7));
    let release: Plain = std::mem::transmute(*vtbl.add(2));
    let icon_res = icon.unwrap_or(exe).display();
    // команда, значок и имя — до ID: панель задач читает их, когда видит новый ID
    for (pid, text) in [
      (RELAUNCH_COMMAND, format!("\"{}\"", exe.display())),
      (RELAUNCH_ICON, format!("{icon_res},0")),
      (RELAUNCH_NAME, name.to_string()),
      (ID, APP_ID.to_string()),
    ] {
      let w = wide(&text);
      let v = PropVariant {
        vt: VT_LPWSTR,
        reserved: [0; 3],
        value: w.as_ptr() as *const c_void,
        pad: 0,
      };
      let hr = set_value(store, &key(pid), &v);
      if hr != 0 {
        log::warn!("taskbar: property {pid}: {hr:#x}");
      }
    }
    commit(store);
    release(store);
  }
}
