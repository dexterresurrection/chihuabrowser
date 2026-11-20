/*
Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN, based on Telegram Desktop.
Licensed under GNU GPL v3 with the OpenSSL exception, like Telegram Desktop.
*/
#pragma once

#include <QtCore/QString>
#include <QtCore/QByteArray>
#include <QtCore/QJsonObject>
#include <QtCore/QJsonArray>
#include <vector>

#include <rpl/producer.h>

namespace Tgx {

// brand.json + gram.json next to the executable (written by our installer; never in the public repository):
// {"brand":"cloud"|"vice","name":"Cloud Gram","product":"gram-win","version":"0.1.0","api_id":…,"api_hash":"…",
//  "bypass":{"mode":"auto","xray":[outbound…],"mtproto":[{"server","port","secret"}…],"profiles_url":""},
//  "downloads":"https://cabinet.zjd.uk/app/downloads.json"}
struct Brand {
	QString line;
	QString name;
	QString product;
	int apiId = 0;
	QString apiHash;
	QJsonObject json;
};

[[nodiscard]] const Brand &GetBrand();
[[nodiscard]] bool IsVice();
[[nodiscard]] bool Ru();
[[nodiscard]] QString T(const char *ru, const char *en);
[[nodiscard]] QString IntroAbout();

// Runtime replacements for the compile-time constants of config.h / version.h.
int ApiIdValue();
QString ApiHashValue();

struct AppNameValue {
	[[nodiscard]] QString utf16() const;
	[[nodiscard]] QByteArray utf8() const;
	[[nodiscard]] const char *data() const;
};

void Start(); // after the settings are read: bypass, updates
void ConnectionStateChanged(int state); // main DC of the active account

enum class BypassMode {
	Auto = 0,
	Always = 1,
	Off = 2,
};

[[nodiscard]] BypassMode GetBypassMode();
void SetBypassMode(BypassMode mode);
[[nodiscard]] std::vector<QString> BypassModeNames();
[[nodiscard]] QString BypassTitle();
[[nodiscard]] rpl::producer<QString> BypassStatusValue();
[[nodiscard]] bool BypassActive();
[[nodiscard]] QString AppsTitle();
void OpenApps();

} // namespace Tgx
