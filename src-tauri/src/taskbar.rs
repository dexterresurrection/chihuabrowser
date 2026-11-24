//! Значок и имя окна на панели задач Windows.
//!
//! tauri ставит окну только малый значок; кнопку на панели задач рисует большой (ICON_BIG), и без него там остаётся
//! значок exe — у Vice Antidetect это была Chihua. Здесь окну ставятся оба значка из .ico (или из самого exe) и
//! свойства AppUserModel: имя и значок, с которыми окно закрепляется на панели задач.
//! AppUserModelID — идентификатор программы, тот же, что у ярлыков установщика.
//!
//! Одного WM_SETICON мало (проверено на Windows Server 2025): панель задач создаёт кнопку вместе с окном, со значком exe,
//! и со сменой значка её не перерисовывает, потому что идентификатор группы не изменился. Поэтому кнопка убирается и
//! добавляется заново (ITaskbarList), и так несколько раз: окно могло ещё не появиться на панели.

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

#[link(name = "ole32")]
extern "system" {
  fn CoInitializeEx(reserved: *mut c_void, kind: u32) -> i32;
  fn CoUninitialize();
  fn CoCreateInstance(
    clsid: *const Guid,
    outer: *mut c_void,
    ctx: u32,
    iid: *const Guid,
    out: *mut *mut c_void,
  ) -> i32;
}
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

const CLSID_TASKBAR_LIST: Guid = Guid(
  0x56FD_F344,
  0xFD6D,
  0x11D0,
  [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
);
const IID_TASKBAR_LIST: Guid = Guid(
  0x56FD_F342,
  0xFD6D,
  0x11D0,
  [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
);

/// Убрать кнопку окна с панели задач и добавить снова: она берёт значок окна заново.
fn recreate_button(hwnd: isize) {
  const CLSCTX_INPROC_SERVER: u32 = 1;
  let mut list: *mut c_void = std::ptr::null_mut();
  unsafe {
    let hr = CoCreateInstance(
      &CLSID_TASKBAR_LIST,
      std::ptr::null_mut(),
      CLSCTX_INPROC_SERVER,
      &IID_TASKBAR_LIST,
      &mut list,
    );
    if hr != 0 || list.is_null() {
      log::warn!("taskbar: ITaskbarList {hr:#x}");
      return;
    }
    // ITaskbarList: 0–2 IUnknown, 3 HrInit, 4 AddTab, 5 DeleteTab, 6 ActivateTab
    type Plain = unsafe extern "system" fn(*mut c_void) -> i32;
    type Tab = unsafe extern "system" fn(*mut c_void, isize) -> i32;
    let vtbl = *(list as *const *const *const c_void);
    let init: Plain = std::mem::transmute(*vtbl.add(3));
    let add: Tab = std::mem::transmute(*vtbl.add(4));
    let delete: Tab = std::mem::transmute(*vtbl.add(5));
    let release: Plain = std::mem::transmute(*vtbl.add(2));
    if init(list) == 0 {
      delete(list, hwnd);
      add(list, hwnd);
    }
    release(list);
  }
}

static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Значки и имя — сейчас и ещё несколько раз следом; новая смена линии отменяет прежние повторы.
pub fn set(hwnd: isize, name: &str, exe: &Path, icon: Option<&Path>) {
  use std::sync::atomic::Ordering;
  let gen = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
  let (name, exe) = (name.to_string(), exe.to_path_buf());
  let icon = icon.map(Path::to_path_buf);
  std::thread::spawn(move || {
    unsafe { CoInitializeEx(std::ptr::null_mut(), 2) }; // COINIT_APARTMENTTHREADED
    for wait in [0u64, 700, 2500, 8000] {
      std::thread::sleep(std::time::Duration::from_millis(wait));
      if GENERATION.load(Ordering::SeqCst) != gen {
        break;
      }
      apply(hwnd, &name, &exe, icon.as_deref());
      recreate_button(hwnd);
    }
    unsafe { CoUninitialize() };
  });
}

/// Значки окна и свойства панели задач. icon — .ico линии; None — значок самой программы (exe).
fn apply(hwnd: isize, name: &str, exe: &Path, icon: Option<&Path>) {
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
