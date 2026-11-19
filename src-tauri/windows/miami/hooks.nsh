; Miami Browser (the Vice line of Chihua): the same program — same uninstall key, folder, exe, data and
; AppUserModelID — with its own name, icon and default theme. Tauri includes this file into installer.nsi.
!define MIAMI_ASSETS "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  ; shortcut and "Apps" icon (installer.nsi: DISPLAYICON); shortcuts are created later in this section
  SetOutPath "$INSTDIR"
  File "/oname=miami.ico" "${MIAMI_ASSETS}\miami.ico"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; line and default theme: the app reads brand.json next to itself (the common format of our installers)
  FileOpen $0 "$INSTDIR\brand.json" w
  FileWrite $0 '{"v":1,"brand":"vice","name":"Miami Browser","theme":"vice-night"}'
  FileClose $0
  ; Chihua shortcuts from an earlier install of the other line
  Delete "$SMPROGRAMS\Chihua.lnk"
  Delete "$DESKTOP\Chihua.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
