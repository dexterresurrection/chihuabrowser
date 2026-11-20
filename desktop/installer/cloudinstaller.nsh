; Общий фирменный установщик программ CloudVPN для Windows (NSIS 3 + MUI2, собирается на Linux: makensis).
; Тёмные цвета Cloud VPN на всех страницах, своя страница «Параметры» с тремя галочками (по умолчанию включены):
;   ☑ Значок на рабочем столе   ☑ Значок на панели задач   ☑ Запускать вместе с Windows
; Подробности и пример — README.md рядом. Подключение (до !insertmacro страниц):
;
;   !define CI_APPNAME   "Cloud Zapret"          ; название (ярлыки, заголовки)
;   !define CI_EXE       "CloudZapret.exe"       ; exe в $INSTDIR
;   !define CI_RUNVALUE  "CloudZapret"           ; имя значения автозапуска в HKCU\…\Run — то же, что пишет сама программа
;   !define CI_RUNARGS   "--minimized"           ; аргументы автозапуска (можно пустые)
;   !define CI_REGKEY    "Software\CloudZapret"  ; ключ программы в HKCU: сюда пишется PinTaskbarHint (см. README)
;   !define CI_ASSETS    "…\assets"              ; icon.ico, wizard.bmp (164×314), header.bmp (150×57) — make_assets.py
;   !include "cloudinstaller.nsh"
;   !insertmacro CI_PAGES                        ; приветствие → папка → параметры → установка → готово
;   !insertmacro CI_UNPAGES
;   !insertmacro MUI_LANGUAGE "Russian"
;   … в секции установки, после файлов:  !insertmacro CI_APPLY_OPTIONS
;   … в секции удаления:                  !insertmacro CI_REMOVE_SHORTCUTS
;
; На странице «Готово» — галочка «Запустить …» (без прав администратора, через explorer.exe); без неё: !define CI_NO_RUN.
;
; Линия (бренд): Cloud (по умолчанию) или Vice — один .nsi, линия задаётся при сборке: makensis -DCI_BRAND=vice …
;   !define CI_VICENAME  "Vice Zapret DPI"       ; имя в линии Vice (нужно для vice; для cloud — чтобы убрать ярлыки Vice)
;   !define CI_ASSETS_VICE "…\assets\vice"        ; картинки Vice (make_assets.py --brand vice); без него — CI_ASSETS
;   !define CI_THEME     "vice-day"              ; тема по умолчанию в brand.json (vice: vice-night, cloud: пусто)
;   !define CI_VICEOLDNAME "Vice Zapret"         ; прежнее имя линии Vice (программу переименовали): из папки «…\Vice Zapret»
;                                                ; установщик любой линии переезжает, как из папки другой линии; ярлыки с ним убирает
; После !include: ${CI_APPNAME} — имя в выбранной линии (его и ставьте в Name, InstallDir, тексты), ${CI_CLOUDNAME},
; ${CI_BRAND}, ${CI_ICON} (значок ярлыков, для DisplayIcon). Ключ Uninstall\<Key>, AUMID, имя exe и папки данных у линий общие — их не меняйте по линии.
; Установщик пишет $INSTDIR\brand.json: {"v":1,"brand":"vice","name":"Vice Zapret DPI","theme":"vice-night"} — по нему
; программа выбирает имя и тему. Переезд из папки другой линии: CI_ONINIT "<ключ Uninstall>" в .onInit и CI_TAKEOVER
; перед File (README).

!ifndef CI_APPNAME
  !error "cloudinstaller.nsh: задайте CI_APPNAME"
!endif
!ifndef CI_EXE
  !error "cloudinstaller.nsh: задайте CI_EXE"
!endif
!ifndef CI_RUNVALUE
  !error "cloudinstaller.nsh: задайте CI_RUNVALUE"
!endif
!ifndef CI_REGKEY
  !error "cloudinstaller.nsh: задайте CI_REGKEY"
!endif
!ifndef CI_ASSETS
  !error "cloudinstaller.nsh: задайте CI_ASSETS"
!endif
!ifndef CI_RUNARGS
  !define CI_RUNARGS ""
!endif

; ---------- линия: cloud или vice ----------
!ifndef CI_BRAND
  !define CI_BRAND "cloud"
!endif
!if "${CI_BRAND}" != "cloud"
  !if "${CI_BRAND}" != "vice"
    !error "cloudinstaller.nsh: CI_BRAND — cloud или vice"
  !endif
!endif
!define CI_CLOUDNAME "${CI_APPNAME}"
!undef CI_APPNAME
!if "${CI_BRAND}" == "vice"
  !ifndef CI_VICENAME
    !error "cloudinstaller.nsh: для CI_BRAND=vice задайте CI_VICENAME (например «Vice Zapret DPI»)"
  !endif
  !define CI_APPNAME "${CI_VICENAME}"
  !define CI_OTHERNAME "${CI_CLOUDNAME}"
  !ifdef CI_ASSETS_VICE
    !define CI_IMG "${CI_ASSETS_VICE}"
  !else
    !define CI_IMG "${CI_ASSETS}"
  !endif
  !ifndef CI_THEME
    !define CI_THEME "vice-night"
  !endif
!else
  !define CI_APPNAME "${CI_CLOUDNAME}"
  !ifdef CI_VICENAME
    !define CI_OTHERNAME "${CI_VICENAME}"
  !endif
  !define CI_IMG "${CI_ASSETS}"
  !ifndef CI_THEME
    !define CI_THEME ""
  !endif
!endif
; прежнее имя Vice-линии: его папка и ярлыки — как у другой линии (CI_ONINIT, CI_TAKEOVER, CI_APPLY_OPTIONS, удаление)
!ifdef CI_VICEOLDNAME
  !if "${CI_VICEOLDNAME}" != "${CI_APPNAME}"
    !define CI_OLDNAME "${CI_VICEOLDNAME}"
  !endif
!endif

; brand.json рядом с exe (UTF-8 без BOM) — собирается здесь же, в установщик кладёт CI_APPLY_OPTIONS
!tempfile CI_BRANDFILE
!appendfile /CHARSET=UTF8 /RAWNL "${CI_BRANDFILE}" '{"v":1,"brand":"${CI_BRAND}","name":"${CI_APPNAME}","theme":"${CI_THEME}"}'

; значок ярлыков («Пуск», рабочий стол) и «Программ и компонентов» (пишите DisplayIcon '"${CI_ICON}",${CI_ICONIDX}'):
; у Vice — значок линии ${CI_IMG}\icon.ico, установщик кладёт его в $INSTDIR\brand.ico (exe у линий один, и его
; собственный значок может остаться Cloud); у Cloud — сам exe. Свой файл в $INSTDIR — !define CI_LINKICON "$INSTDIR\…".
!ifdef CI_LINKICON
  !define CI_ICON "${CI_LINKICON}"
!else
  !if "${CI_BRAND}" == "vice"
    !define CI_ICON "$INSTDIR\brand.ico"
    !define CI_BRANDICO
  !else
    !define CI_ICON "$INSTDIR\${CI_EXE}"
  !endif
!endif
!define CI_ICONIDX 0

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"

; ---------- цвета линии ----------
!if "${CI_BRAND}" == "vice"
  ; Vice ночь — палитра набора дизайна Vice v2 (/root/cloudvpn-design 091b637); header.bmp слева растворяется в #140A33
  !define CI_BG     "140A33"  ; фон — ночное небо
  !define CI_PANEL  "160A3D"  ; поля ввода
  !define CI_TEXT   "FFF6FD"  ; текст
  !define CI_MUTED  "E4D2FF"  ; пояснения
  !define CI_ACCENT "FF2BD6"  ; полоса установки — маджента v2
  !define CI_BGRGB  0x330A14  ; тот же фон в виде COLORREF (0x00BBGGRR) — для полосы установки
  !define CI_ACCRGB 0xD62BFF
!else
  ; Cloud VPN
  !define CI_BG     "0A0F1A"
  !define CI_PANEL  "131C30"
  !define CI_TEXT   "E8EDF7"
  !define CI_MUTED  "8D99B3"
  !define CI_ACCENT "39D98A"
  !define CI_BGRGB  0x1A0F0A
  !define CI_ACCRGB 0x8AD939
!endif

!define MUI_BGCOLOR "${CI_BG}"
!define MUI_TEXTCOLOR "${CI_TEXT}"
!define MUI_ICON "${CI_IMG}\icon.ico"
!define MUI_UNICON "${CI_IMG}\icon.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${CI_IMG}\wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${CI_IMG}\wizard.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${CI_IMG}\header.bmp"
!define MUI_ABORTWARNING
!define MUI_CUSTOMFUNCTION_GUIINIT CI_GuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.CI_GuiInit

; выбор человека (1 — да). В тихой установке (/S, обновление из программы) страница не показывается:
; ярлыки и автозапуск тогда не трогаются — остаётся, как было.
Var CI_Desktop
Var CI_Taskbar
Var CI_Autostart
Var CI_Dlg
Var CI_CbDesktop
Var CI_CbTaskbar
Var CI_CbAutostart
Var CI_OldDir   ; папка другой линии (…\Cloud VPN при установке Vice VPN) — её уберёт CI_TAKEOVER
Var CI_RePin    ; ярлык другой линии был закреплён на панели задач — программа подскажет закрепить свой
Var CI_HadRun   ; у программы другой линии был автозапуск (её удаление его снимает — вернём с новой папкой)

; отладка: makensis -DCI_DEBUG — шаги пишутся в %TEMP%\cloudinstaller.log
!macro CI_LOG MSG
  !ifdef CI_DEBUG
    Push $9
    FileOpen $9 "$TEMP\cloudinstaller.log" a
    FileSeek $9 0 END
    FileWrite $9 "${MSG}$\r$\n"
    FileClose $9
    Pop $9
  !endif
!macroend

; ---------- тёмное оформление ----------

; без темы Windows у кнопок-галочек и полосы можно задать свои цвета
!macro CI_NoTheme HWND
  System::Call 'uxtheme::SetWindowTheme(p ${HWND}, w " ", w " ")'
!macroend

; перекрасить окно и всё, что в нём (дочерние элементы — до 200 штук)
!macro CI_DarkChildren PARENT
  Push $R7
  Push $R8
  StrCpy $R8 0
  StrCpy $R7 0
  ${Do}
    FindWindow $R8 "" "" ${PARENT} $R8
    ${If} $R8 == 0
      ${Break}
    ${EndIf}
    SetCtlColors $R8 ${CI_TEXT} ${CI_BG}
    IntOp $R7 $R7 + 1
    ${If} $R7 > 200
      ${Break}
    ${EndIf}
  ${Loop}
  Pop $R8
  Pop $R7
!macroend

!macro CI_GuiInitBody
  SetCtlColors $HWNDPARENT ${CI_TEXT} ${CI_BG}
  ; нижняя полоса окна: надпись «Cloud …» и разделители
  GetDlgItem $0 $HWNDPARENT 1028
  ${If} $0 != 0
    SetCtlColors $0 ${CI_MUTED} ${CI_BG}
  ${EndIf}
  GetDlgItem $0 $HWNDPARENT 1256
  ${If} $0 != 0
    SetCtlColors $0 ${CI_MUTED} ${CI_BG}
  ${EndIf}
!macroend
Function CI_GuiInit
  !insertmacro CI_GuiInitBody
FunctionEnd
Function un.CI_GuiInit
  !insertmacro CI_GuiInitBody
FunctionEnd

; внутренняя страница MUI (папка, установка, подтверждение удаления) — в тёмные цвета
!macro CI_DarkInnerBody
  FindWindow $1 "#32770" "" $HWNDPARENT
  SetCtlColors $1 ${CI_TEXT} ${CI_BG}
  !insertmacro CI_DarkChildren $1
  ; рамка «Папка установки» и прочие подписи рамок — без темы, иначе чёрный текст на тёмном
  GetDlgItem $0 $1 1020
  ${If} $0 != 0
    !insertmacro CI_NoTheme $0
    SetCtlColors $0 ${CI_MUTED} ${CI_BG}
  ${EndIf}
  ; поле с папкой — чуть светлее фона
  GetDlgItem $0 $1 1019
  ${If} $0 != 0
    SetCtlColors $0 ${CI_TEXT} ${CI_PANEL}
  ${EndIf}
  ; полоса установки: зелёная на тёмном
  GetDlgItem $0 $1 1004
  ${If} $0 != 0
    !insertmacro CI_NoTheme $0
    SendMessage $0 0x0409 0 ${CI_ACCRGB}   ; PBM_SETBARCOLOR
    SendMessage $0 0x2001 0 ${CI_BGRGB}    ; PBM_SETBKCOLOR
  ${EndIf}
!macroend
Function CI_DarkInner
  !insertmacro CI_LOG "dark inner start"
  !insertmacro CI_DarkInnerBody
  !insertmacro CI_LOG "dark inner end"
FunctionEnd
Function un.CI_DarkInner
  !insertmacro CI_DarkInnerBody
FunctionEnd

; ---------- страница «Параметры» ----------

Function CI_OptionsShow
  !insertmacro CI_LOG "options show"
  !insertmacro MUI_HEADER_TEXT "Параметры" "Что сделать после установки ${CI_APPNAME}"
  nsDialogs::Create 1018
  Pop $CI_Dlg
  ${If} $CI_Dlg == error
    Abort
  ${EndIf}
  SetCtlColors $CI_Dlg ${CI_TEXT} ${CI_BG}

  ${NSD_CreateCheckbox} 0 6u 100% 14u "Значок на рабочем столе"
  Pop $CI_CbDesktop
  ${NSD_CreateCheckbox} 0 28u 100% 14u "Значок на панели задач"
  Pop $CI_CbTaskbar
  ${NSD_CreateCheckbox} 0 50u 100% 14u "Запускать вместе с Windows (значок в трее)"
  Pop $CI_CbAutostart
  ${NSD_CreateLabel} 0 76u 100% 40u "Значок на панели задач Windows 10 и 11 разрешает закрепить только вручную. Если он не появится сам, ${CI_APPNAME} при первом запуске подскажет, как закрепить его в один клик."
  Pop $0
  SetCtlColors $0 ${CI_MUTED} ${CI_BG}

  ${ForEach} $1 0 2 + 1
    ${If} $1 == 0
      StrCpy $2 $CI_CbDesktop
      StrCpy $3 $CI_Desktop
    ${ElseIf} $1 == 1
      StrCpy $2 $CI_CbTaskbar
      StrCpy $3 $CI_Taskbar
    ${Else}
      StrCpy $2 $CI_CbAutostart
      StrCpy $3 $CI_Autostart
    ${EndIf}
    !insertmacro CI_NoTheme $2
    SetCtlColors $2 ${CI_TEXT} ${CI_BG}
    ${If} $3 == 1
      ${NSD_Check} $2
    ${EndIf}
  ${Next}
  nsDialogs::Show
FunctionEnd

Function CI_OptionsLeave
  !insertmacro CI_LOG "options leave"
  ${NSD_GetState} $CI_CbDesktop $CI_Desktop
  ${NSD_GetState} $CI_CbTaskbar $CI_Taskbar
  ${NSD_GetState} $CI_CbAutostart $CI_Autostart
FunctionEnd

; запуск программы без прав администратора (установщик сам запущен с ними): через explorer.exe
Function CI_RunApp
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${CI_EXE}"'
FunctionEnd

; ---------- страницы ----------

!macro CI_PAGES
  Function CI_InitOptions
    ; по умолчанию все три галочки стоят
    StrCpy $CI_Desktop 1
    StrCpy $CI_Taskbar 1
    StrCpy $CI_Autostart 1
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE CI_InitOptionsOnce
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW CI_DarkInner
  !insertmacro MUI_PAGE_DIRECTORY
  Page custom CI_OptionsShow CI_OptionsLeave
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW CI_DarkInner
  !insertmacro MUI_PAGE_INSTFILES
  !ifndef CI_NO_RUN
    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Запустить ${CI_APPNAME}"
    !define MUI_FINISHPAGE_RUN_FUNCTION CI_RunApp
  !endif
  !if "${CI_BRAND}" == "vice"
    !ifndef MUI_FINISHPAGE_TITLE
      !define MUI_FINISHPAGE_TITLE "Миссия выполнена"
    !endif
    !ifndef MUI_FINISHPAGE_TEXT
      !define MUI_FINISHPAGE_TEXT "${CI_APPNAME} установлен на этот компьютер.$\r$\n$\r$\nНажмите «Готово»."
    !endif
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW CI_FinishShow
  !insertmacro MUI_PAGE_FINISH
  ; галочка «Запустить …» на странице «Готово» читалась бы чёрным по тёмному (переменная MUI — после страницы)
  Function CI_FinishShow
    !ifndef CI_NO_RUN
      ${If} $mui.FinishPage.Run != ""
        !insertmacro CI_NoTheme $mui.FinishPage.Run
        SetCtlColors $mui.FinishPage.Run ${CI_TEXT} ${CI_BG}
      ${EndIf}
    !endif
  FunctionEnd
  Function CI_InitOptionsOnce
    ${If} $CI_Desktop == ""
      Call CI_InitOptions
    ${EndIf}
  FunctionEnd
!macroend

!macro CI_UNPAGES
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.CI_DarkInner
  !insertmacro MUI_UNPAGE_CONFIRM
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW un.CI_DarkInner
  !insertmacro MUI_UNPAGE_INSTFILES
!macroend

; ---------- что делают галочки (в секции установки, после файлов). Ярлыки — в контексте, который выставил ваш скрипт:
; SetShellVarContext all (для всех) или current (для одного пользователя, RequestExecutionLevel user) ----------

; контекст ярлыков (SetShellVarContext all — для всех, current — для одного пользователя) задаёт ваш скрипт; макросы
; набора, которым нужен другой, запоминают его и возвращают тот же (узнают по $SMPROGRAMS)
!macro CI_CTX_SAVE
  Push $SMPROGRAMS
!macroend
!macro CI_CTX_RESTORE
  Exch $0
  SetShellVarContext current
  StrCmp $SMPROGRAMS $0 +2
    SetShellVarContext all
  Pop $0
!macroend

; ярлыки с именем NAME (рабочий стол и «Пуск» — общие и свои, закреплённый на панели задач); контекст — прежний
!macro CI_REMOVE_LINKS NAME
  !insertmacro CI_CTX_SAVE
  SetShellVarContext all
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  SetShellVarContext current
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${NAME}.lnk"
  !insertmacro CI_CTX_RESTORE
!macroend

; ---------- смена линии (Cloud ↔ Vice) ----------

; в .onInit, после SetRegView 64: UNKEY — ключ «Программ и компонентов» (общий у линий; HKLM, иначе HKCU). Если программа стоит
; в папке другой линии («…\Cloud VPN» при установке Vice VPN), ставим рядом свою, а прежнюю запоминаем для CI_TAKEOVER.
; Папку берём из InstallLocation ключа (InstallDirRegKey читает реестр до SetRegView и может её не увидеть).
!macro CI_ONINIT UNKEY
  !ifdef CI_OTHERNAME
    Push $0
    Push $1
    ReadRegStr $0 HKLM "${UNKEY}" "InstallLocation"
    ${If} $0 == ""
      ReadRegStr $0 HKCU "${UNKEY}" "InstallLocation"   ; программа ставится для одного пользователя (ключ в HKCU)
    ${EndIf}
    !insertmacro CI_LOG "oninit: InstallLocation=$0 INSTDIR=$INSTDIR"
    ${If} $0 == ""
      StrCpy $0 "$INSTDIR"
    ${EndIf}
    ${GetFileName} "$0" $1
    ${If} $1 == "${CI_OTHERNAME}"
      StrCpy $CI_OldDir "$0"
      ${GetParent} "$0" $1
      StrCpy $INSTDIR "$1\${CI_APPNAME}"
    !ifdef CI_OLDNAME
    ${ElseIf} $1 == "${CI_OLDNAME}"
      StrCpy $CI_OldDir "$0"
      ${GetParent} "$0" $1
      StrCpy $INSTDIR "$1\${CI_APPNAME}"
    !endif
    ${EndIf}
    Pop $1
    Pop $0
  !endif
!macroend

; в секции установки — после закрытия запущенной программы и ДО файлов и записей в реестр: тихо удаляет
; программу другой линии её же uninstall.exe (настройки и данные остаются: общие у линий) и её папку
!macro CI_TAKEOVER
  ${If} $CI_OldDir != ""
  ${AndIf} $CI_OldDir != $INSTDIR
  ${AndIf} ${FileExists} "$CI_OldDir\uninstall.exe"
    DetailPrint "Убираю прежнюю установку из $CI_OldDir…"
    ReadRegStr $CI_HadRun HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}"
    Push $0
    !insertmacro CI_LOG "takeover: $CI_OldDir"
    ExecWait '"$CI_OldDir\uninstall.exe" /S _?=$CI_OldDir' $0
    !insertmacro CI_LOG "takeover: uninstall.exe exit $0"
    ; uninstall.exe только что закрылся — Windows может ещё держать файл: несколько попыток, потом — после перезагрузки
    StrCpy $0 0
    ${Do}
      RMDir /r "$CI_OldDir"
      ${IfNot} ${FileExists} "$CI_OldDir\*.*"
        ${Break}
      ${EndIf}
      IntOp $0 $0 + 1
      ${If} $0 > 25
        RMDir /r /REBOOTOK "$CI_OldDir"
        ${Break}
      ${EndIf}
      Sleep 300
    ${Loop}
    !insertmacro CI_LOG "takeover: removal tries $0"
    Pop $0
  ${EndIf}
!macroend

!macro CI_APPLY_OPTIONS
  !insertmacro CI_LOG "apply options"
  ; brand.json рядом с exe: линия, имя и тема по умолчанию — всегда, и при тихом обновлении
  SetOutPath "$INSTDIR"
  File "/oname=brand.json" "${CI_BRANDFILE}"
  !ifdef CI_BRANDICO
    File "/oname=brand.ico" "${CI_IMG}\icon.ico"
  !else
    Delete "$INSTDIR\brand.ico"   ; от прежней линии Vice в той же папке
  !endif
  ; ярлыки другой линии больше не нужны (её программа заменена этой)
  StrCpy $CI_RePin 0
  !ifdef CI_OTHERNAME
    !insertmacro CI_CTX_SAVE
    SetShellVarContext current
    ${If} ${FileExists} "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${CI_OTHERNAME}.lnk"
      StrCpy $CI_RePin 1
    ${EndIf}
    !ifdef CI_OLDNAME
      ${If} ${FileExists} "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${CI_OLDNAME}.lnk"
        StrCpy $CI_RePin 1
      ${EndIf}
    !endif
    !insertmacro CI_CTX_RESTORE
    !insertmacro CI_REMOVE_LINKS "${CI_OTHERNAME}"
  !endif
  !ifdef CI_OLDNAME
    !insertmacro CI_REMOVE_LINKS "${CI_OLDNAME}"
  !endif
  ; ярлык в меню «Пуск» — всегда, и в тихой установке (через него же закрепляют на панели задач)
  CreateShortcut "$SMPROGRAMS\${CI_APPNAME}.lnk" "$INSTDIR\${CI_EXE}" "" "${CI_ICON}" ${CI_ICONIDX}
  ${IfNot} ${Silent}
    ${If} $CI_Desktop == 1
      CreateShortcut "$DESKTOP\${CI_APPNAME}.lnk" "$INSTDIR\${CI_EXE}" "" "${CI_ICON}" ${CI_ICONIDX}
    ${Else}
      Delete "$DESKTOP\${CI_APPNAME}.lnk"
    ${EndIf}
    ${If} $CI_Autostart == 1
      ${If} "${CI_RUNARGS}" == ""
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}" '"$INSTDIR\${CI_EXE}"'
      ${Else}
        WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}" '"$INSTDIR\${CI_EXE}" ${CI_RUNARGS}'
      ${EndIf}
    ${Else}
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}"
    ${EndIf}
    ${If} $CI_Taskbar == 1
      ; закрепить: работает только там, где Windows ещё отдаёт команду «Закрепить на панели задач»
      ; (Windows 10 до 1809); дальше Microsoft разрешает только вручную — программа подскажет (PinTaskbarHint)
      nsExec::Exec /TIMEOUT=8000 `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "try { $$f=(New-Object -ComObject Shell.Application).Namespace('$INSTDIR').ParseName('${CI_EXE}'); $$v=$$f.Verbs() | Where-Object { ($$_.Name -replace '&','') -match 'taskbar|панел' -and ($$_.Name -replace '&','') -notmatch 'unpin|изъять|открепить' }; if ($$v) { $$v.DoIt() } } catch {}"`
      Pop $0
      WriteRegDWORD HKCU "${CI_REGKEY}" "PinTaskbarHint" 1
    ${Else}
      WriteRegDWORD HKCU "${CI_REGKEY}" "PinTaskbarHint" 0
    ${EndIf}
  ${EndIf}
  ${If} $CI_RePin == 1
    WriteRegDWORD HKCU "${CI_REGKEY}" "PinTaskbarHint" 1
  ${EndIf}
  ; тихая установка поверх другой линии: её автозапуск снят её же удалением — возвращаем, уже с этой папкой
  ${If} ${Silent}
  ${AndIf} $CI_HadRun != ""
    ${If} "${CI_RUNARGS}" == ""
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}" '"$INSTDIR\${CI_EXE}"'
    ${Else}
      WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}" '"$INSTDIR\${CI_EXE}" ${CI_RUNARGS}'
    ${EndIf}
  ${EndIf}
  StrCpy $CI_HadRun ""
  StrCpy $CI_OldDir ""  ; переезд из папки другой линии (если был) закончен
!macroend

; ---------- удаление ----------

; ярлыки обеих линий, автозапуск, подсказка о панели задач и brand.json (папку программы — тоже, если она пуста)
!macro CI_REMOVE_SHORTCUTS
  !insertmacro CI_REMOVE_LINKS "${CI_APPNAME}"
  !ifdef CI_OTHERNAME
    !insertmacro CI_REMOVE_LINKS "${CI_OTHERNAME}"
  !endif
  !ifdef CI_OLDNAME
    !insertmacro CI_REMOVE_LINKS "${CI_OLDNAME}"
  !endif
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${CI_RUNVALUE}"
  DeleteRegValue HKCU "${CI_REGKEY}" "PinTaskbarHint"
  Delete "$INSTDIR\brand.json"
  Delete "$INSTDIR\brand.ico"
  RMDir "$INSTDIR"
!macroend
