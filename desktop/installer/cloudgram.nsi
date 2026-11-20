; Cloud Gram / Vice Gram for Windows — installer on the shared CloudVPN kit (cloudinstaller.nsh, copy of
; /root/cloudvpn-windows/installer/kit, commit in kit-commit.txt).
;   makensis -DSTAGE=<dir with CloudGram.exe, xray.exe, gram.json> -DVERSION=0.1.0 -DOUTFILE=CloudGram-Setup.exe cloudgram.nsi
;   makensis -DCI_BRAND=vice … -DOUTFILE=ViceGram-Setup.exe cloudgram.nsi
; gram.json (api keys, bypass profiles) is made on our side at release time and is never in the repository.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!define CI_APPNAME "Cloud Gram"
!define CI_VICENAME "Vice Gram"
!define CI_EXE "CloudGram.exe"
!define CI_RUNVALUE "CloudGram"
!define CI_RUNARGS "-autostart"
!define CI_REGKEY "Software\CloudGram"
!define CI_ASSETS "${__FILEDIR__}\assets"
!define CI_ASSETS_VICE "${__FILEDIR__}\assets-vice"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CloudGram"
!include "${__FILEDIR__}\cloudinstaller.nsh"

Name "${CI_APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\${CI_APPNAME}"
BrandingText "${CI_APPNAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "${CI_APPNAME}"
VIAddVersionKey /LANG=1049 "CompanyName" "CloudVPN"
VIAddVersionKey /LANG=1049 "FileDescription" "${CI_APPNAME} — неофициальный клиент Telegram"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "GPL-3.0; based on Telegram Desktop"

!define MUI_WELCOMEPAGE_TITLE "Установка ${CI_APPNAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "${CI_APPNAME} — неофициальный клиент Telegram от CloudVPN на открытом коде Telegram Desktop.$\r$\n$\r$\nЕсли Telegram в вашей сети замедлен или заблокирован, сообщения, файлы и звонки сами пойдут через серверы CloudVPN — только трафик этой программы.$\r$\n$\r$\nНажмите «Далее»."
!insertmacro CI_PAGES
!insertmacro CI_UNPAGES
!insertmacro MUI_LANGUAGE "Russian"

Function .onInit
  SetRegView 64
  !insertmacro CI_ONINIT "${UNKEY}"
FunctionEnd

Section "main"
  SetShellVarContext all
  ; the running client and its xray core (the core dies with the client: job object)
  nsExec::Exec 'taskkill /F /IM "${CI_EXE}"'
  Sleep 800
  !insertmacro CI_TAKEOVER
  SetOutPath "$INSTDIR"
  File "${STAGE}\${CI_EXE}"
  File "${STAGE}\xray.exe"
  File "${STAGE}\gram.json"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  !insertmacro CI_APPLY_OPTIONS
  WriteRegStr HKLM "${UNKEY}" "DisplayName" "${CI_APPNAME}"
  WriteRegStr HKLM "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNKEY}" "Publisher" "CloudVPN"
  WriteRegStr HKLM "${UNKEY}" "DisplayIcon" '"${CI_ICON}",${CI_ICONIDX}'
  WriteRegStr HKLM "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNKEY}" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
SectionEnd

Function un.onInit
  SetRegView 64
FunctionEnd

Section "Uninstall"
  SetShellVarContext all
  nsExec::Exec 'taskkill /F /IM "${CI_EXE}"'
  Sleep 800
  Delete "$INSTDIR\${CI_EXE}"
  Delete "$INSTDIR\xray.exe"
  Delete "$INSTDIR\gram.json"
  Delete "$INSTDIR\uninstall.exe"
  !insertmacro CI_REMOVE_SHORTCUTS
  DeleteRegKey HKLM "${UNKEY}"
SectionEnd
