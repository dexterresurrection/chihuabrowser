#!/usr/bin/env python3
"""Cloud Gram / Vice Gram on top of Telegram Desktop (GPL-3.0 with the OpenSSL exception).

    python3 desktop/apply.py <tdesktop checkout>

Literal edits with checks (the script stops if upstream moved an anchor) + new files from desktop/overlay/.
One build serves both lines: the line, the name and the api keys come from brand.json next to the executable
(written by our installer), so CMake gets TDESKTOP_API_TEST only to pass its own check — config.h no longer uses it.
Configure with: -D TDESKTOP_API_TEST=ON -D DESKTOP_APP_DISABLE_AUTOUPDATE=ON -D DESKTOP_APP_DISABLE_CRASH_REPORTS=ON
"""
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APP_GUID = '{6B1E2F1C-4A3D-4C6E-9C1B-CD1A7E0B5A21}'


def die(msg):
    sys.exit('desktop/apply.py: ' + msg)


class Src:
    def __init__(self, base, rel):
        self.path = os.path.join(base, rel)
        self.rel = rel
        if not os.path.exists(self.path):
            die(f'no file {rel}')
        self.text = open(self.path, encoding='utf-8', newline='').read()

    def replace(self, old, new, count=1):
        n = self.text.count(old)
        if n == 0:
            die(f'{self.rel}: anchor not found: {old[:140]!r}')
        if count and n != count:
            die(f'{self.rel}: anchor found {n} times (want {count}): {old[:140]!r}')
        self.text = self.text.replace(old, new)

    def sub(self, pattern, repl, flags=0, min_count=1):
        new, n = re.subn(pattern, repl, self.text, flags=flags)
        if n < min_count:
            die(f'{self.rel}: pattern not found: {pattern[:140]!r}')
        self.text = new

    def save(self):
        open(self.path, 'w', encoding='utf-8', newline='').write(self.text)


def main():
    if len(sys.argv) < 2:
        die(__doc__)
    up = os.path.abspath(sys.argv[1])
    S = 'Telegram/SourceFiles/'

    # ---- api keys at run time (brand.json), never the official ones, never compiled in
    c = Src(up, S + 'config.h')
    start = c.text.index('#if defined TDESKTOP_API_ID && defined TDESKTOP_API_HASH')
    end = c.text.index('#endif // TDESKTOP_API_ID && TDESKTOP_API_HASH') + len('#endif // TDESKTOP_API_ID && TDESKTOP_API_HASH')
    c.text = c.text[:start] + ('// Cloud Gram: api_id / api_hash come from brand.json next to the executable (tgx/tgx.cpp).\n'
                               '#include "tgx/tgx.h"\n'
                               '#define ApiId (Tgx::ApiIdValue())\n'
                               '#define ApiHash (Tgx::ApiHashValue())') + c.text[end:]
    c.save()

    # ---- names: not «Telegram Desktop», own GUID, own data folder, no migration from the official app's folders
    v = Src(up, S + 'core/version.h')
    v.sub(r'constexpr auto AppId = "\{[0-9A-F-]+\}"_cs;', f'constexpr auto AppId = "{APP_GUID}"_cs;')
    v.replace('constexpr auto AppNameOld = "Telegram Win (Unofficial)"_cs;', 'constexpr auto AppNameOld = "Cloud Gram Old"_cs;')
    v.replace('constexpr auto AppName = "Telegram Desktop"_cs;', '#include "tgx/tgx.h"\ninline constexpr Tgx::AppNameValue AppName{}; // brand name at run time')
    v.replace('constexpr auto AppFile = "Telegram"_cs;', 'constexpr auto AppFile = "CloudGram"_cs;')
    v.save()
    w = Src(up, S + 'platform/win/specific_win.cpp')
    w.replace("return appData.absolutePath() + '/' + AppName.utf16() + '/';", "return appData.absolutePath() + u\"/Cloud Gram/\"_q;")
    w.replace('"\\\\Telegram.lnk"', '"\\\\CloudGram.lnk"', count=2)
    w.save()
    lx = Src(up, S + 'platform/linux/specific_linux.cpp')
    lx.replace('auto oldPath = home + u"/.TelegramDesktop/"_q;', 'auto oldPath = home + u"/.CloudGram-legacy/"_q;')
    lx.save()
    la = Src(up, S + 'core/launcher.cpp')
    la.replace('QApplication::setApplicationName(u"TelegramDesktop"_q);', 'QApplication::setApplicationName(u"CloudGram"_q);')
    la.save()
    mw = Src(up, S + 'window/main_window.cpp')
    mw.replace('setTitle((user.isEmpty() ? u"Telegram"_q : user) + added + suffix);',
               'setTitle((user.isEmpty() ? Tgx::GetBrand().name : user) + added + suffix);')
    mw.replace('#include "window/main_window.h"\n', '#include "window/main_window.h"\n\n#include "tgx/tgx.h"\n')
    mw.save()

    # ---- texts: never «official», the app is called by its brand name (cloud language packs included)
    li = Src(up, S + 'lang/lang_instance.cpp')
    li.replace('''	ParseKeyValue(key, value, [&](ushort key, QString &&value) {
		_nonDefaultSet[key] = 1;''', '''	ParseKeyValue(key, value, [&](ushort key, QString &&value) {
		if (key == tr::lng_intro_about.base) {
			value = Tgx::IntroAbout();
		} else {
			value.replace(u"Telegram Desktop"_q, Tgx::GetBrand().name);
		}
		_nonDefaultSet[key] = 1;''')
    li.replace('#include "lang/lang_instance.h"\n', '#include "lang/lang_instance.h"\n\n#include "tgx/tgx.h"\n')
    li.save()
    ls = Src(up, 'Telegram/Resources/langs/lang.strings')
    ls.sub(r'"lng_intro_about" = "[^"]*";', '"lng_intro_about" = "Unofficial Telegram client by CloudVPN.\\\\nWith a built-in bypass of blocks.";')
    ls.text = re.sub(r'^("lng_[^"]*" = ")(.*)$', lambda m: m.group(1) + m.group(2).replace('Telegram Desktop', 'Cloud Gram'),
                     ls.text, flags=re.M)
    ls.save()

    # ---- start, connection state
    ap = Src(up, S + 'core/application.cpp')
    ap.replace('	refreshGlobalProxy(); // Depends on app settings being read.\n',
               '	refreshGlobalProxy(); // Depends on app settings being read.\n	Tgx::Start(); // bypass + updates (Cloud Gram)\n')
    ap.replace('''		int32 state) {
	_private->proxyRotation->handleConnectionStateChanged(account, state);''', '''		int32 state) {
	if (account == &activeAccount()) {
		Tgx::ConnectionStateChanged(state);
	}
	_private->proxyRotation->handleConnectionStateChanged(account, state);''')
    ap.replace('#include "core/application.h"\n', '#include "core/application.h"\n\n#include "tgx/tgx.h"\n')
    ap.save()

    # ---- settings → advanced → connection: bypass mode and our apps
    sa = Src(up, S + 'settings/sections/settings_advanced.cpp')
    sa.replace('''	button->addClickHandler([=] {
		controller->show(ProxiesBoxController::CreateOwningBox(account));
	});
}''', '''	button->addClickHandler([=] {
		controller->show(ProxiesBoxController::CreateOwningBox(account));
	});
	const auto bypass = AddButtonWithLabel(
		container,
		rpl::single(Tgx::BypassTitle()),
		Tgx::BypassStatusValue(),
		st::settingsButton,
		{ &st::menuIconNetwork });
	bypass->addClickHandler([=] {
		controller->show(Box([](not_null<Ui::GenericBox*> box) {
			const auto options = Tgx::BypassModeNames();
			SingleChoiceBox(box, {
				.title = rpl::single(Tgx::BypassTitle()),
				.options = options,
				.initialSelection = int(Tgx::GetBypassMode()),
				.callback = [](int index) {
					Tgx::SetBypassMode(Tgx::BypassMode(index));
				},
			});
		}));
	});
	const auto apps = AddButtonWithLabel(
		container,
		rpl::single(Tgx::AppsTitle()),
		rpl::single(QString()),
		st::settingsButton,
		{ &st::menuIconNetwork });
	apps->addClickHandler([] { Tgx::OpenApps(); });
}''')
    sa.replace('#include "settings/sections/settings_advanced.h"\n', '#include "settings/sections/settings_advanced.h"\n\n#include "tgx/tgx.h"\n')
    sa.save()

    # ---- build files
    cm = Src(up, 'Telegram/CMakeLists.txt')
    cm.replace('    config.h\n', '    config.h\n    tgx/tgx.cpp\n    tgx/tgx.h\n')
    cm.save()
    rc = Src(up, 'Telegram/Resources/winrc/Telegram.rc')
    rc.replace('VALUE "CompanyName", "Telegram FZ-LLC"', 'VALUE "CompanyName", "CloudVPN"')
    rc.replace('VALUE "FileDescription", "Telegram Desktop"', 'VALUE "FileDescription", "Cloud Gram (unofficial Telegram client)"')
    rc.replace('VALUE "ProductName", "Telegram Desktop"', 'VALUE "ProductName", "Cloud Gram"')
    rc.save()

    # ---- overlay: our sources and icons over Telegram's logo files
    ov = os.path.join(HERE, 'overlay')
    for dp, _, files in os.walk(ov):
        for f in files:
            src = os.path.join(dp, f)
            dst = os.path.join(up, os.path.relpath(src, ov))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
    print('applied')


if __name__ == '__main__':
    main()
