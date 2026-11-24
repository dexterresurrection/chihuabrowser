; Vice Antidetect (the Vice line of Chihua, product miami; until 2026-11-20 called Miami Browser): the same program —
; same uninstall key, folder, exe, data and AppUserModelID — with its own name, icon and default theme.
; Tauri includes this file into installer.nsi.
!define MIAMI_ASSETS "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  ; shortcut and "Apps" icon (installer.nsi: DISPLAYICON); shortcuts are created later in this section
  SetOutPath "$INSTDIR"
  File "/oname=miami.ico" "${MIAMI_ASSETS}\miami.ico"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; line and default theme: the app reads brand.json next to itself (the common format of our installers)
  FileOpen $0 "$INSTDIR\brand.json" w
  FileWrite $0 '{"v":1,"brand":"vice","name":"Vice Antidetect","theme":"vice-night"}'
  FileClose $0
  ; shortcuts of the old name (Miami Browser): Start menu goes away (the installer made Vice Antidetect.lnk),
  ; a desktop shortcut is replaced by one with the new name
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  IfFileExists "$DESKTOP\Miami Browser.lnk" 0 vice_no_old_desktop
    Delete "$DESKTOP\Miami Browser.lnk"
    CreateShortcut "$DESKTOP\${DISPLAYNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "${DISPLAYICON}" 0
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${DISPLAYNAME}.lnk"
  vice_no_old_desktop:
  ; Chihua shortcuts from an earlier install of the other line
  Delete "$SMPROGRAMS\Chihua.lnk"
  Delete "$DESKTOP\Chihua.lnk"
  ; the shell keeps icons of shortcuts and programs: the line has changed, let it read them again (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  Delete "$DESKTOP\Miami Browser.lnk"
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
