; Vice Antidetect (the Vice line of Chihua, product miami; until 2026-11-20 called Miami Browser): the same program —
; same uninstall key, folder, exe, data and AppUserModelID — with its own name, icon and default theme.
; Tauri includes this file into installer.nsi.
!define MIAMI_ASSETS "${__FILEDIR__}"
Var ViceOldDesktop

!macro NSIS_HOOK_PREINSTALL
  ; shortcut and "Apps" icon (installer.nsi: DISPLAYICON); shortcuts are created later in this section
  SetOutPath "$INSTDIR"
  File "/oname=miami.ico" "${MIAMI_ASSETS}\miami.ico"
  ; Shortcuts of the other line and of the old name go away BEFORE ours are created: all carry the same AppUserModelID,
  ; and the shell keeps the first one it saw. Removed afterwards, it left the taskbar button with a stale or blank icon.
  Delete "$SMPROGRAMS\Chihua.lnk"
  Delete "$DESKTOP\Chihua.lnk"
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  StrCpy $ViceOldDesktop ""
  IfFileExists "$DESKTOP\Miami Browser.lnk" 0 vice_no_old_desktop
    StrCpy $ViceOldDesktop "1"
    Delete "$DESKTOP\Miami Browser.lnk"
  vice_no_old_desktop:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; line and default theme: the app reads brand.json next to itself (the common format of our installers)
  FileOpen $0 "$INSTDIR\brand.json" w
  FileWrite $0 '{"v":1,"brand":"vice","name":"Vice Antidetect","theme":"vice-night"}'
  FileClose $0
  ; a desktop shortcut of the old name is replaced by one with the new name
  StrCmp $ViceOldDesktop "1" 0 vice_desktop_done
    CreateShortcut "$DESKTOP\${DISPLAYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "${DISPLAYICON}" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${DISPLAYNAME}.lnk"
  vice_desktop_done:
  ; the shell keeps icons of shortcuts and programs: the line has changed, let it read them again (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  Delete "$DESKTOP\Miami Browser.lnk"
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
