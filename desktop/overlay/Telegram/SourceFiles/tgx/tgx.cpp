/*
Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN, based on Telegram Desktop.
Licensed under GNU GPL v3 with the OpenSSL exception, like Telegram Desktop.
*/
#include "tgx/tgx.h"

#include "base/timer.h"
#include "core/application.h"
#include "core/core_settings.h"
#include "core/file_utilities.h"
#include "mtproto/facade.h"
#include "mtproto/mtproto_proxy_data.h"
#include "ui/boxes/confirm_box.h"
#include "window/window_controller.h"
#include "settings.h"

#include <QtCore/QCoreApplication>
#include <QtCore/QDateTime>
#include <QtCore/QDir>
#include <QtCore/QFile>
#include <QtCore/QJsonDocument>
#include <QtCore/QLocale>
#include <QtCore/QProcess>
#include <QtCore/QRandomGenerator>
#include <QtCore/QStandardPaths>
#include <QtCore/QUrl>
#include <QtNetwork/QHostAddress>
#include <QtNetwork/QHostInfo>
#include <QtNetwork/QNetworkAccessManager>
#include <QtNetwork/QNetworkReply>
#include <QtNetwork/QNetworkRequest>
#include <QtNetwork/QTcpSocket>

#ifdef Q_OS_WIN
#include <windows.h>
#endif // Q_OS_WIN

#include <rpl/variable.h>

namespace Tgx {
namespace {

constexpr auto kDirectGrace = crl::time(8000);
constexpr auto kRemember = crl::time(6 * 3600 * 1000);
constexpr auto kProbeEvery = crl::time(30 * 60 * 1000);
const auto kLocal = QString::fromLatin1("127.0.0.1");

QString ExeDir() {
	return QCoreApplication::applicationDirPath() + '/';
}

QString StateDir() {
	const auto dir = cWorkingDir() + QString::fromLatin1("tdata/tgx/");
	QDir().mkpath(dir);
	return dir;
}

QJsonObject ReadJson(const QString &path) {
	auto f = QFile(path);
	if (!f.open(QIODevice::ReadOnly)) {
		return {};
	}
	return QJsonDocument::fromJson(f.readAll()).object();
}

void WriteJson(const QString &path, const QJsonObject &o) {
	auto f = QFile(path);
	if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
		f.write(QJsonDocument(o).toJson(QJsonDocument::Compact));
	}
}

QString RandomHex(int bytes) {
	auto result = QByteArray(bytes, Qt::Uninitialized);
	for (auto &c : result) {
		c = char(QRandomGenerator::system()->generate() & 0xFF);
	}
	return QString::fromLatin1(result.toHex());
}

bool PortOpen(int port) {
	if (port <= 0) {
		return false;
	}
	auto socket = QTcpSocket();
	socket.connectToHost(QHostAddress(kLocal), quint16(port));
	return socket.waitForConnected(300);
}

class Bypass final : public QObject {
public:
	static Bypass &Instance() {
		static auto result = new Bypass();
		return *result;
	}

	void start();
	void connectionState(int state);
	BypassMode mode() const {
		return _mode;
	}
	void setMode(BypassMode mode);
	bool active() const {
		return _active;
	}
	rpl::producer<QString> statusValue() const {
		return _status.value();
	}
	void stopXray();

private:
	Bypass() = default;

	void tick();
	void enable(const QString &why);
	void disable(const QString &why);
	bool startXray();
	QJsonObject profiles() const;
	QJsonObject config(const QJsonArray &outbounds) const;
	void useTelegramProxy(const MTP::ProxyData &proxy);
	MTP::ProxyData localProxy() const;
	bool ourProxyCurrent() const;
	bool ourMtproto(const MTP::ProxyData &proxy) const;
	bool userProxyInUse() const;
	void addMtprotoFallbacks();
	void save();
	void updateStatus();
	void note(const QString &text);

	BypassMode _mode = BypassMode::Auto;
	QJsonObject _state;
	QString _user, _pass;
	int _port = 0;
	bool _started = false;
	bool _active = false;
	int _lastState = -1;
	crl::time _connectingSince = 0;
	crl::time _lastProbe = 0;
	int _restarts = 0;
	QProcess *_xray = nullptr;
	base::Timer _timer;
	rpl::variable<QString> _status;
#ifdef Q_OS_WIN
	HANDLE _job = nullptr;
#endif // Q_OS_WIN

};

void Bypass::note(const QString &text) {
	LOG(("Tgx: %1").arg(text));
}

void Bypass::start() {
	if (_started) {
		return;
	}
	_started = true;
	_state = ReadJson(StateDir() + QString::fromLatin1("bypass.json"));
	if (!_state.contains(u"mode"_q)) {
		const auto m = GetBrand().json.value(u"bypass"_q).toObject().value(u"mode"_q).toString();
		_state.insert(u"mode"_q, (m == u"always"_q) ? 1 : (m == u"off"_q) ? 2 : 0);
	}
	_mode = BypassMode(std::clamp(_state.value(u"mode"_q).toInt(), 0, 2));
	_user = _state.value(u"user"_q).toString();
	_pass = _state.value(u"pass"_q).toString();
	if (_user.isEmpty() || _pass.isEmpty()) {
		_user = u"tg"_q + RandomHex(6);
		_pass = RandomHex(16);
		_state.insert(u"user"_q, _user);
		_state.insert(u"pass"_q, _pass);
	}
	save();
	addMtprotoFallbacks();
	QObject::connect(qApp, &QCoreApplication::aboutToQuit, [=] { stopXray(); });
	const auto key = u"need_until"_q;
	const auto remembered = qint64(_state.value(key).toDouble()) > QDateTime::currentMSecsSinceEpoch();
	if (_mode == BypassMode::Always || (_mode == BypassMode::Auto && remembered)) {
		enable(u"start"_q);
	} else if (ourProxyCurrent()) {
		disable(u"stale local proxy from the last run"_q);
	}
	_timer.setCallback([=] { tick(); });
	_timer.callEach(2000);
	updateStatus();
	note(u"brand %1, api %2, mode %3"_q.arg(GetBrand().line).arg(GetBrand().apiId > 0 ? u"set"_q : u"MISSING"_q).arg(int(_mode)));
}

void Bypass::save() {
	WriteJson(StateDir() + QString::fromLatin1("bypass.json"), _state);
}

void Bypass::setMode(BypassMode mode) {
	_mode = mode;
	_state.insert(u"mode"_q, int(mode));
	save();
	if (mode == BypassMode::Always) {
		enable(u"mode"_q);
	} else if (mode == BypassMode::Off) {
		disable(u"mode"_q);
	} else {
		_connectingSince = 0;
	}
	updateStatus();
}

void Bypass::connectionState(int state) {
	if (state != _lastState) {
		_lastState = state;
		note(u"telegram state %1 (%2)"_q.arg(state).arg(_active ? u"bypass"_q : u"direct"_q));
	}
	if (state == MTP::ConnectedState) {
		_connectingSince = 0;
	} else if (!_connectingSince) {
		_connectingSince = crl::now();
	}
	updateStatus();
}

void Bypass::tick() {
	const auto now = crl::now();
	if (_mode == BypassMode::Auto) {
		if (!_active
			&& _connectingSince
			&& !userProxyInUse()
			&& now - _connectingSince >= kDirectGrace) {
			_state.insert(u"need_until"_q, double(QDateTime::currentMSecsSinceEpoch() + kRemember));
			save();
			enable(u"auto: no direct connection for %1 s"_q.arg((now - _connectingSince) / 1000));
		} else if (_active && now - _lastProbe >= kProbeEvery) {
			_lastProbe = now;
			// off the UI thread: up to 4 TCP connects of 3 s each
			crl::async([=] {
				auto ok = 0;
				for (const auto ip : { "149.154.175.50", "149.154.167.51", "149.154.175.100", "149.154.167.91" }) {
					auto socket = QTcpSocket();
					socket.connectToHost(QHostAddress(QString::fromLatin1(ip)), 443);
					if (socket.waitForConnected(3000) && ++ok >= 2) {
						break;
					}
				}
				crl::on_main([=] {
					if (ok >= 2 && _active && _mode == BypassMode::Auto) {
						_state.insert(u"need_until"_q, 0.);
						save();
						disable(u"auto: direct path answers again"_q);
					}
				});
			});
		}
	}
	if (_active && _mode != BypassMode::Off && (!_xray || _xray->state() == QProcess::NotRunning) && _restarts < 20) {
		++_restarts;
		if (startXray()) {
			useTelegramProxy(localProxy());
		}
	}
}

MTP::ProxyData Bypass::localProxy() const {
	auto result = MTP::ProxyData();
	result.type = MTP::ProxyData::Type::Socks5;
	result.host = kLocal;
	result.port = uint32(_port);
	result.user = _user;
	result.password = _pass;
	return result;
}

bool Bypass::ourProxyCurrent() const {
	const auto &proxy = Core::App().settings().proxy();
	const auto &selected = proxy.selected();
	return proxy.isEnabled()
		&& selected.type == MTP::ProxyData::Type::Socks5
		&& selected.host == kLocal
		&& selected.user == _user;
}

bool Bypass::ourMtproto(const MTP::ProxyData &proxy) const {
	if (proxy.type != MTP::ProxyData::Type::Mtproto) {
		return false;
	}
	for (const auto &v : profiles().value(u"mtproto"_q).toArray()) {
		const auto o = v.toObject();
		if (o.value(u"server"_q).toString() == proxy.host
			&& uint32(o.value(u"port"_q).toInt()) == proxy.port) {
			return true;
		}
	}
	return false;
}

bool Bypass::userProxyInUse() const {
	const auto &proxy = Core::App().settings().proxy();
	return proxy.isEnabled() && !ourProxyCurrent() && !ourMtproto(proxy.selected());
}

void Bypass::addMtprotoFallbacks() {
	const auto list = profiles().value(u"mtproto"_q).toArray();
	const auto version = u"%1:%2"_q.arg(profiles().value(u"version"_q).toString()).arg(list.size());
	if (_state.value(u"mtproto_added"_q).toString() == version) {
		return;
	}
	auto &settings = Core::App().settings().proxy();
	for (const auto &v : list) {
		const auto o = v.toObject();
		auto proxy = MTP::ProxyData();
		proxy.type = MTP::ProxyData::Type::Mtproto;
		proxy.host = o.value(u"server"_q).toString();
		proxy.port = uint32(o.value(u"port"_q).toInt(443));
		proxy.password = o.value(u"secret"_q).toString();
		if (proxy.valid() && settings.indexInList(proxy) < 0) {
			settings.addToList(proxy);
		}
	}
	settings.setProxyRotationEnabled(true);
	Core::App().saveSettingsDelayed();
	_state.insert(u"mtproto_added"_q, version);
	save();
}

void Bypass::enable(const QString &why) {
	if (userProxyInUse()) {
		return;
	}
	note(u"enable: "_q + why);
	_active = true;
	_restarts = 0;
	_lastProbe = crl::now();
	if (startXray()) {
		useTelegramProxy(localProxy());
	} else {
		// no profiles or the core did not start: our MTProto proxies with Telegram's own rotation
		for (const auto &proxy : Core::App().settings().proxy().list()) {
			if (ourMtproto(proxy)) {
				useTelegramProxy(proxy);
				break;
			}
		}
	}
	updateStatus();
}

void Bypass::disable(const QString &why) {
	note(u"disable: "_q + why);
	_active = false;
	const auto &proxy = Core::App().settings().proxy();
	if (ourProxyCurrent() || (proxy.isEnabled() && ourMtproto(proxy.selected()))) {
		Core::App().setCurrentProxy(proxy.selected(), MTP::ProxyData::Settings::System);
		Core::App().saveSettingsDelayed();
	}
	stopXray();
	updateStatus();
}

void Bypass::useTelegramProxy(const MTP::ProxyData &value) {
	auto &settings = Core::App().settings().proxy();
	// the local port changes between runs: drop our old local entries
	auto &list = settings.list();
	list.erase(ranges::remove_if(list, [&](const MTP::ProxyData &p) {
		return p.type == MTP::ProxyData::Type::Socks5
			&& p.host == kLocal
			&& p.user == _user
			&& p != value;
	}), end(list));
	if (settings.indexInList(value) < 0) {
		settings.insertToList(0, value);
	}
	settings.setUseProxyForCalls(true);
	Core::App().setCurrentProxy(value, MTP::ProxyData::Settings::Enabled);
	Core::App().saveSettingsDelayed();
}

QJsonObject Bypass::profiles() const {
	const auto cached = ReadJson(StateDir() + QString::fromLatin1("profiles.json"));
	if (!cached.value(u"xray"_q).toArray().isEmpty()) {
		return cached;
	}
	return GetBrand().json.value(u"bypass"_q).toObject();
}

QJsonObject Bypass::config(const QJsonArray &outbounds) const {
	auto outs = QJsonArray();
	for (auto i = 0; i != outbounds.size(); ++i) {
		auto o = outbounds[i].toObject();
		o.insert(u"tag"_q, u"px-%1"_q.arg(i));
		// server names are resolved here (Go on Windows does it too, but this keeps one path for all platforms)
		auto settings = o.value(u"settings"_q).toObject();
		for (const auto key : { u"vnext"_q, u"servers"_q }) {
			auto servers = settings.value(key).toArray();
			for (auto j = 0; j != servers.size(); ++j) {
				auto s = servers[j].toObject();
				const auto host = s.value(u"address"_q).toString();
				if (!host.isEmpty() && QHostAddress(host).isNull()) {
					const auto info = QHostInfo::fromName(host);
					for (const auto &a : info.addresses()) {
						if (a.protocol() == QAbstractSocket::IPv4Protocol) {
							s.insert(u"address"_q, a.toString());
							break;
						}
					}
				}
				servers[j] = s;
			}
			if (!servers.isEmpty()) {
				settings.insert(key, servers);
			}
		}
		o.insert(u"settings"_q, settings);
		outs.append(o);
	}
	outs.append(QJsonObject{ { u"tag"_q, u"block"_q }, { u"protocol"_q, u"blackhole"_q } });
	const auto socks = QJsonObject{
		{ u"tag"_q, u"in"_q },
		{ u"listen"_q, kLocal },
		{ u"port"_q, _port },
		{ u"protocol"_q, u"socks"_q },
		{ u"settings"_q, QJsonObject{
			{ u"auth"_q, u"password"_q },
			{ u"udp"_q, true },
			{ u"ip"_q, kLocal },
			{ u"accounts"_q, QJsonArray{ QJsonObject{ { u"user"_q, _user }, { u"pass"_q, _pass } } } },
		} },
	};
	auto routing = QJsonObject{ { u"domainStrategy"_q, u"AsIs"_q } };
	auto result = QJsonObject{
		{ u"log"_q, QJsonObject{ { u"loglevel"_q, u"warning"_q } } },
		{ u"inbounds"_q, QJsonArray{ socks } },
		{ u"outbounds"_q, outs },
		{ u"dns"_q, QJsonObject{ { u"servers"_q, QJsonArray{ u"1.1.1.1"_q, u"8.8.8.8"_q, u"77.88.8.8"_q } } } },
	};
	if (outbounds.size() > 1) {
		routing.insert(u"balancers"_q, QJsonArray{ QJsonObject{
			{ u"tag"_q, u"bal"_q },
			{ u"selector"_q, QJsonArray{ u"px-"_q } },
			{ u"strategy"_q, QJsonObject{ { u"type"_q, u"leastPing"_q } } },
		} });
		routing.insert(u"rules"_q, QJsonArray{ QJsonObject{
			{ u"type"_q, u"field"_q },
			{ u"inboundTag"_q, QJsonArray{ u"in"_q } },
			{ u"balancerTag"_q, u"bal"_q },
		} });
		result.insert(u"observatory"_q, QJsonObject{
			{ u"subjectSelector"_q, QJsonArray{ u"px-"_q } },
			{ u"probeUrl"_q, u"https://www.gstatic.com/generate_204"_q },
			{ u"probeInterval"_q, u"3m"_q },
			{ u"enableConcurrency"_q, true },
		});
	} else {
		routing.insert(u"rules"_q, QJsonArray{ QJsonObject{
			{ u"type"_q, u"field"_q },
			{ u"inboundTag"_q, QJsonArray{ u"in"_q } },
			{ u"outboundTag"_q, u"px-0"_q },
		} });
	}
	result.insert(u"routing"_q, routing);
	return result;
}

bool Bypass::startXray() {
	if (_xray && _xray->state() != QProcess::NotRunning && PortOpen(_port)) {
		return true;
	}
	stopXray();
	const auto outbounds = profiles().value(u"xray"_q).toArray();
	if (outbounds.isEmpty()) {
		note(u"no xray profiles"_q);
		return false;
	}
#ifdef Q_OS_WIN
	const auto bin = ExeDir() + u"xray.exe"_q;
#else // Q_OS_WIN
	const auto bin = ExeDir() + u"xray"_q;
#endif // Q_OS_WIN
	if (!QFile::exists(bin)) {
		note(u"no xray core next to the executable: "_q + bin);
		return false;
	}
	_port = _state.value(u"port"_q).toInt();
	if (!_port || PortOpen(_port)) {
		_port = 20000 + int(QRandomGenerator::system()->bounded(40000));
		_state.insert(u"port"_q, _port);
		save();
	}
	const auto cfg = StateDir() + u"xray.json"_q;
	WriteJson(cfg, config(outbounds));
	QFile::setPermissions(cfg, QFileDevice::ReadOwner | QFileDevice::WriteOwner);
	_xray = new QProcess(this);
	_xray->setProgram(bin);
	_xray->setArguments({ u"run"_q, u"-c"_q, cfg });
	_xray->setWorkingDirectory(StateDir());
	_xray->setProcessChannelMode(QProcess::MergedChannels);
	QObject::connect(_xray, &QProcess::readyRead, [=] {
		while (_xray && _xray->canReadLine()) {
			note(u"xray: "_q + QString::fromUtf8(_xray->readLine()).trimmed());
		}
	});
	_xray->start();
	if (!_xray->waitForStarted(5000)) {
		note(u"xray did not start: "_q + _xray->errorString());
		return false;
	}
#ifdef Q_OS_WIN
	// the core dies with us even after a crash: a job object closed with the last handle
	if (!_job) {
		_job = CreateJobObjectW(nullptr, nullptr);
		auto info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
		info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		SetInformationJobObject(_job, JobObjectExtendedLimitInformation, &info, sizeof(info));
	}
	if (const auto process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, DWORD(_xray->processId()))) {
		AssignProcessToJobObject(_job, process);
		CloseHandle(process);
	}
#endif // Q_OS_WIN
	for (auto i = 0; i != 40; ++i) {
		if (PortOpen(_port)) {
			note(u"xray up on %1, outbounds %2"_q.arg(_port).arg(outbounds.size()));
			return true;
		}
		if (_xray->state() == QProcess::NotRunning) {
			break;
		}
		_xray->waitForFinished(100);
	}
	note(u"xray did not open its port"_q);
	return false;
}

void Bypass::stopXray() {
	if (const auto xray = base::take(_xray)) {
		xray->disconnect();
		xray->kill();
		xray->waitForFinished(2000);
		xray->deleteLater();
	}
}

void Bypass::updateStatus() {
	const auto m = (_mode == BypassMode::Always)
		? T("всегда", "always")
		: (_mode == BypassMode::Off)
		? T("выключен", "off")
		: T("авто", "auto");
	_status = m + u" · "_q + (_active
		? T("сейчас через обход", "now via bypass")
		: T("сейчас напрямую", "now direct"));
}

void CheckUpdates() {
	const auto url = GetBrand().json.value(u"downloads"_q).toString(u"https://cabinet.zjd.uk/app/downloads.json"_q);
	const auto manager = new QNetworkAccessManager(qApp);
	const auto reply = manager->get(QNetworkRequest(QUrl(url)));
	QObject::connect(reply, &QNetworkReply::finished, [=] {
		reply->deleteLater();
		manager->deleteLater();
		const auto root = QJsonDocument::fromJson(reply->readAll()).object();
		const auto product = root.value(u"products"_q).toObject().value(GetBrand().product).toObject();
		const auto latest = product.value(u"version"_q).toString();
		const auto mine = GetBrand().json.value(u"version"_q).toString();
		if (latest.isEmpty() || mine.isEmpty()) {
			return;
		}
		const auto a = latest.split('.'), b = mine.split('.');
		auto newer = false;
		for (auto i = 0; i != std::max(a.size(), b.size()); ++i) {
			const auto x = (i < a.size()) ? a[i].toInt() : 0;
			const auto y = (i < b.size()) ? b[i].toInt() : 0;
			if (x != y) {
				newer = (x > y);
				break;
			}
		}
		if (!newer) {
			return;
		}
		auto link = QString();
		for (const auto &v : product.value(u"files"_q).toArray()) {
			const auto f = v.toObject();
			if (f.value(u"name"_q).toString().endsWith(u".exe"_q)) {
				link = f.value(u"github"_q).toString(f.value(u"server"_q).toString());
				break;
			}
		}
		if (link.isEmpty()) {
			return;
		}
		if (const auto window = Core::App().activePrimaryWindow()) {
			window->show(Ui::MakeConfirmBox({
				.text = GetBrand().name + u" "_q + latest + u"\n\n"_q + product.value(u"notes"_q).toString(),
				.confirmed = [=](Fn<void()> close) { File::OpenUrl(link); close(); },
				.confirmText = T("Скачать", "Download"),
				.cancelText = T("Позже", "Later"),
				.title = T("Доступно обновление", "Update available"),
			}));
		}
	});
}

} // namespace

const Brand &GetBrand() {
	static const auto result = [] {
		auto b = Brand();
		// brand.json — line, name, theme (written by the shared installer kit on every install/update);
		// gram.json — api keys, bypass profiles, product (built on our side at release time, never in the repository)
		b.json = ReadJson(ExeDir() + QString::fromLatin1("brand.json"));
		const auto gram = ReadJson(ExeDir() + QString::fromLatin1("gram.json"));
		for (auto i = gram.begin(); i != gram.end(); ++i) {
			b.json.insert(i.key(), i.value());
		}
		b.line = (b.json.value(u"brand"_q).toString() == u"vice"_q) ? u"vice"_q : u"cloud"_q;
		b.name = b.json.value(u"name"_q).toString((b.line == u"vice"_q) ? u"Vice Gram"_q : u"Cloud Gram"_q);
		b.product = b.json.value(u"product"_q).toString((b.line == u"vice"_q) ? u"vice-gram-win"_q : u"gram-win"_q);
		b.apiId = b.json.value(u"api_id"_q).toInt();
		b.apiHash = b.json.value(u"api_hash"_q).toString();
		if (b.apiHash.size() != 32) {
			b.apiId = 0;
			b.apiHash = QString();
		}
		return b;
	}();
	return result;
}

bool IsVice() {
	return GetBrand().line == u"vice"_q;
}

bool Ru() {
	const auto l = QLocale::system().language();
	return l == QLocale::Russian || l == QLocale::Ukrainian || l == QLocale::Belarusian || l == QLocale::Kazakh;
}

QString T(const char *ru, const char *en) {
	return QString::fromUtf8(Ru() ? ru : en);
}

QString IntroAbout() {
	return T(
		"Неофициальный клиент Telegram от CloudVPN.\nСо встроенным обходом блокировок.",
		"Unofficial Telegram client by CloudVPN.\nWith a built-in bypass of blocks.");
}

int ApiIdValue() {
	return GetBrand().apiId;
}

QString ApiHashValue() {
	return GetBrand().apiHash;
}

QString AppNameValue::utf16() const {
	return GetBrand().name;
}

QByteArray AppNameValue::utf8() const {
	return GetBrand().name.toUtf8();
}

const char *AppNameValue::data() const {
	static const auto result = GetBrand().name.toUtf8();
	return result.constData();
}

void Start() {
	Bypass::Instance().start();
	base::call_delayed(15000, qApp, [] { CheckUpdates(); });
}

void ConnectionStateChanged(int state) {
	Bypass::Instance().connectionState(state);
}

BypassMode GetBypassMode() {
	return Bypass::Instance().mode();
}

void SetBypassMode(BypassMode mode) {
	Bypass::Instance().setMode(mode);
}

std::vector<QString> BypassModeNames() {
	return {
		T("Автоматически (рекомендуется)", "Automatic (recommended)"),
		T("Всегда через обход", "Always via bypass"),
		T("Выключен — только напрямую", "Off — direct only"),
	};
}

QString BypassTitle() {
	return T("Обход блокировок", "Bypass");
}

rpl::producer<QString> BypassStatusValue() {
	return Bypass::Instance().statusValue();
}

bool BypassActive() {
	return Bypass::Instance().active();
}

QString AppsTitle() {
	return IsVice() ? u"Vice apps"_q : T("Наши приложения", "Our apps");
}

void OpenApps() {
	File::OpenUrl(u"https://cabinet.zjd.uk/app/"_q);
}

} // namespace Tgx
