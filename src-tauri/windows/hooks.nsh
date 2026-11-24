; Chihua Browser (the Cloud line): after Vice Antidetect (ex Miami Browser) was installed into the same folder, its brand file,
; icon and shortcuts go away (same program, same uninstall key — see windows/miami/). Tauri includes this file.
!macro NSIS_HOOK_POSTINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
  Delete "$SMPROGRAMS\Vice Antidetect.lnk"
  Delete "$DESKTOP\Vice Antidetect.lnk"
  Delete "$SMPROGRAMS\Miami Browser.lnk"
  Delete "$DESKTOP\Miami Browser.lnk"
  ; the shell keeps icons of shortcuts and programs: the line has changed, let it read them again (SHCNE_ASSOCCHANGED)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\miami.ico"
!macroend
