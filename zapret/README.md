# zapret: обход блокировок без VPN

`zapretctl` — общий переключатель zapret для Chihua Browser, Cloud VPN для Windows и Cloud Browser: одна копия
в `%ProgramData%\CloudVPN\zapret` и служба Windows `CloudVPNZapret`, какая бы из программ её ни включила.

- `bundle.py` собирает пакет: winws v72.9 из релиза [bol-van/zapret](https://github.com/bol-van/zapret) (MIT),
  стратегии, фейковые пакеты и списки [Flowseal 1.10.4](https://github.com/Flowseal/zapret-discord-youtube) (MIT),
  драйвер [WinDivert](https://github.com/basil00/WinDivert) (LGPL-3.0/GPL-2.0) без изменений. Архивы закреплены по SHA-256.
- `zapretctl status | presets | start [--preset ИМЯ] [--game-filter] | stop | uninstall` — ответ одной строкой JSON;
  `start` и `stop` просят права администратора через окно UAC.

Сборка в CI: `.github/workflows/build.yml`, шаг «zapret»; пакет кладётся в `src-tauri/resources/zapret/`.
