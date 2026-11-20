; Chihua Browser (the Cloud line): after Vice Antidetect (ex Miami Browser) was installed into the same folder, its brand file,
; icon and shortcuts go away (same program, same uninstall key — see windows/miami/). Tauri includes this file.
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
  Delete "$SMPROGRAMS\Vice Antidetect.lnk"
  Delete "$DESKTOP\Vice Antidetect.lnk"
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  Delete "$DESKTOP\Miami Browser.lnk"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
