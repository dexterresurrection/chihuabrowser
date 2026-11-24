; Chihua Browser (the Cloud line): after Vice Antidetect (ex Miami Browser) was installed into the same folder, its brand file,
; icon and shortcuts go away (same program, same uninstall key — see windows/miami/). Tauri includes this file.
;
; Shortcuts of the other line go away BEFORE ours is created: both carry the same AppUserModelID, and the shell keeps the
; first one it saw. Removed afterwards, it left the taskbar button with a stale or blank icon.
!macro NSIS_HOOK_PREINSTALL
  Delete "$SMPROGRAMS\Vice Antidetect.lnk"
  Delete "$DESKTOP\Vice Antidetect.lnk"
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  Delete "$DESKTOP\Miami Browser.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
  ; the shell keeps icons of shortcuts and programs: the line has changed, let it read them again (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
