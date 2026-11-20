/*
 * Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN.
 * Licensed under GNU GPL v. 2 or later, like the Telegram for Android sources it is based on.
 */
package uk.zjd.tgx;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;
import org.telegram.messenger.AndroidUtilities;
import org.telegram.messenger.ApplicationLoader;
import org.telegram.messenger.FileLog;
import org.telegram.messenger.MessagesController;
import org.telegram.messenger.NotificationCenter;
import org.telegram.messenger.SharedConfig;
import org.telegram.messenger.UserConfig;
import org.telegram.messenger.voip.Instance;
import org.telegram.tgnet.ConnectionsManager;
import org.telegram.utils.proxy.ProxySettings;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.Locale;

/**
 * Built-in bypass: Telegram traffic (and calls) of this app only goes through our infrastructure when the direct
 * connection does not work. No system VPN: an embedded xray core (lib/&lt;abi&gt;/libxray.so, started as a child process)
 * opens a local SOCKS5 with a random login, and Telegram's own proxy support is pointed at it. Our MTProto proxies are
 * added to the proxy list as a fallback; Telegram's proxy rotation switches to them if the xray tunnel stops.
 *
 * Modes: AUTO (default) — direct first; when the client stays in «Connecting…» for {@link #DIRECT_GRACE_MS}, the
 * bypass turns on and is remembered for this network type for {@link #REMEMBER_MS}; while it is on, the direct path is
 * probed every {@link #PROBE_EVERY_MS} and the bypass turns off when the direct path answers again.
 * ALWAYS — bypass always on. OFF — never (a proxy the user chose himself is never touched in any mode).
 */
public final class Bypass {
    public static final int MODE_AUTO = 0, MODE_ALWAYS = 1, MODE_OFF = 2;
    static final long DIRECT_GRACE_MS = 8_000;
    static final long REMEMBER_MS = 6 * 3600_000L;
    static final long PROBE_EVERY_MS = 30 * 60_000L;
    private static final long TICK_MS = 2_000;
    private static final String LOCAL = "127.0.0.1";
    private static final String[] DC_IPS = {"149.154.175.50", "149.154.167.51", "149.154.175.100", "149.154.167.91", "91.108.56.130"};

    private static Context ctx;
    private static SharedPreferences prefs;
    private static Handler bg;
    private static final Handler ui = new Handler(android.os.Looper.getMainLooper());
    private static Process xray;
    private static int port;
    private static String user, pass;
    private static volatile boolean active;
    private static long connectingSince;
    private static long lastProbe;
    private static String lastError = "";
    private static final ArrayDeque<String> log = new ArrayDeque<>();
    private static int restarts;
    private static int lastState = -1;

    private Bypass() {
    }

    /** Main process only, after the native libraries are loaded. */
    public static void init(Context context) {
        if (ctx != null || context == null || !isMainProcess(context)) {
            return;
        }
        ctx = context.getApplicationContext();
        prefs = ctx.getSharedPreferences("tgx_bypass", Context.MODE_PRIVATE);
        if (!prefs.contains("mode")) {
            final String m = Brand.bypass().optString("mode", "auto");
            prefs.edit().putInt("mode", "always".equals(m) ? MODE_ALWAYS : "off".equals(m) ? MODE_OFF : MODE_AUTO).apply();
        }
        user = prefs.getString("user", null);
        pass = prefs.getString("pass", null);
        if (user == null || pass == null) {
            user = "tg" + randomHex(6);
            pass = randomHex(16);
            prefs.edit().putString("user", user).putString("pass", pass).apply();
        }
        final HandlerThread t = new HandlerThread("tgx-bypass");
        t.start();
        bg = new Handler(t.getLooper());
        bg.post(Bypass::refreshProfiles);
        ui.post(() -> {
            try {
                addMtprotoFallbacks();
            } catch (Throwable e) {
                FileLog.e(e);
            }
            final int mode = getMode();
            if (mode == MODE_ALWAYS || (mode == MODE_AUTO && rememberedNeed())) {
                enable("start");
            } else if (ourProxyIsCurrent()) {
                // the process was killed while the bypass was on: the saved proxy points at a dead local port
                disableTelegramProxy();
            }
            ui.postDelayed(Bypass::tick, TICK_MS);
        });
    }

    public static int getMode() {
        return prefs == null ? MODE_AUTO : prefs.getInt("mode", MODE_AUTO);
    }

    public static void setMode(int mode) {
        if (prefs == null) {
            return;
        }
        prefs.edit().putInt("mode", mode).apply();
        if (mode == MODE_ALWAYS) {
            enable("mode");
        } else if (mode == MODE_OFF) {
            disable("mode");
        } else {
            connectingSince = 0;
        }
        NotificationCenter.getGlobalInstance().postNotificationName(NotificationCenter.proxySettingsChanged);
    }

    public static boolean isActive() {
        return active;
    }

    public static int profileCount() {
        return outbounds().size();
    }

    public static int mtprotoCount() {
        return Brand.array(profilesJson(), "mtproto").length();
    }

    public static String lastError() {
        return lastError;
    }

    public static synchronized String logTail() {
        return TextUtils.join("\n", log);
    }

    /** For VoIPService: private calls go through the same local SOCKS5 (TCP relays) while the bypass is on. */
    public static Instance.Proxy callProxy() {
        if (!active || port == 0) {
            return null;
        }
        return new Instance.Proxy(LOCAL, port, user, pass);
    }

    public static String statusLine() {
        final int mode = getMode();
        final String m = mode == MODE_ALWAYS ? Brand.t("всегда", "always") : mode == MODE_OFF ? Brand.t("выключен", "off") : Brand.t("авто", "auto");
        final String s = active ? Brand.t("сейчас через обход", "now via bypass") : Brand.t("сейчас напрямую", "now direct");
        return Brand.t("Режим: ", "Mode: ") + m + " · " + s;
    }

    // ------------------------------------------------------------------ automatic mode

    private static void tick() {
        try {
            final int mode = getMode();
            final int state = ConnectionsManager.getInstance(UserConfig.selectedAccount).getConnectionState();
            final long now = SystemClock.elapsedRealtime();
            if (state != lastState) {
                lastState = state;
                note("telegram state " + state + (active ? " (bypass)" : " (direct)"));
            }
            final boolean connecting = state == ConnectionsManager.ConnectionStateConnecting || state == ConnectionsManager.ConnectionStateConnectingToProxy;
            if (connecting) {
                if (connectingSince == 0) {
                    connectingSince = now;
                }
            } else {
                connectingSince = 0;
            }
            if (mode == MODE_AUTO) {
                if (!active && connecting && !userProxyInUse() && now - connectingSince >= DIRECT_GRACE_MS) {
                    remember(true);
                    enable("auto: no direct connection for " + (now - connectingSince) / 1000 + " s");
                } else if (active && now - lastProbe >= PROBE_EVERY_MS) {
                    lastProbe = now;
                    bg.post(() -> {
                        if (probeDirect()) {
                            ui.post(() -> {
                                if (getMode() == MODE_AUTO && active) {
                                    remember(false);
                                    disable("auto: direct path answers again");
                                }
                            });
                        }
                    });
                }
            }
            if (active && (xray == null || !alive(xray)) && mode != MODE_OFF) {
                if (restarts < 20) {
                    restarts++;
                    bg.post(Bypass::startXraySafe);
                }
            }
        } catch (Throwable e) {
            FileLog.e(e);
        }
        ui.postDelayed(Bypass::tick, TICK_MS);
    }

    private static String networkKey() {
        try {
            final ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            final NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                return "wifi";
            }
            if (nc != null && nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                return "cell";
            }
        } catch (Throwable ignore) {
        }
        return "other";
    }

    private static boolean rememberedNeed() {
        return prefs.getLong("need_" + networkKey(), 0) > System.currentTimeMillis();
    }

    private static void remember(boolean need) {
        prefs.edit().putLong("need_" + networkKey(), need ? System.currentTimeMillis() + REMEMBER_MS : 0).apply();
    }

    /** Direct path to the Telegram data centers: at least two of them accept a TCP connection within 3 s. */
    public static boolean probeDirect() {
        int ok = 0;
        for (String ip : DC_IPS) {
            try (Socket s = new Socket()) {
                s.connect(new InetSocketAddress(ip, 443), 3000);
                ok++;
            } catch (Throwable ignore) {
            }
            if (ok >= 2) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ switching

    private static boolean userProxyInUse() {
        return SharedConfig.isProxyEnabled() && !ourProxyIsCurrent() && !isOurMtproto(SharedConfig.currentProxy);
    }

    private static boolean ourProxyIsCurrent() {
        final SharedConfig.ProxyInfo p = SharedConfig.currentProxy;
        return p != null && p.settings.getType() == ProxySettings.Type.SOCKS5 && LOCAL.equals(p.settings.getAddress()) && user != null && user.equals(p.settings.getUser());
    }

    private static boolean isOurMtproto(SharedConfig.ProxyInfo p) {
        if (p == null || p.settings.getType() != ProxySettings.Type.MTPROTO) {
            return false;
        }
        final JSONArray list = Brand.array(profilesJson(), "mtproto");
        for (int i = 0; i < list.length(); i++) {
            final JSONObject o = list.optJSONObject(i);
            if (o != null && o.optString("server").equals(p.settings.getAddress()) && o.optInt("port") == p.settings.getPort()) {
                return true;
            }
        }
        return false;
    }

    public static void enable(String why) {
        if (ctx == null || userProxyInUse()) {
            return;
        }
        note("enable: " + why);
        active = true;
        restarts = 0;
        lastProbe = SystemClock.elapsedRealtime();
        bg.post(() -> {
            final boolean ok = startXraySafe();
            ui.post(() -> {
                if (!active) {
                    return;
                }
                if (ok) {
                    useTelegramProxy(ProxySettings.builder().setType(ProxySettings.Type.SOCKS5)
                            .setAddress(LOCAL).setPort(port).setUser(user).setPassword(pass).build());
                } else {
                    // no xray profiles or the core did not start: our MTProto proxies with Telegram's own rotation
                    final SharedConfig.ProxyInfo mt = firstMtproto();
                    if (mt != null) {
                        useTelegramProxy(mt.settings);
                    }
                }
            });
        });
    }

    public static void disable(String why) {
        note("disable: " + why);
        active = false;
        if (ourProxyIsCurrent() || isOurMtproto(SharedConfig.currentProxy)) {
            disableTelegramProxy();
        }
        bg.post(Bypass::stopXray);
    }

    private static void useTelegramProxy(ProxySettings s) {
        SharedConfig.loadProxyList();
        // the local port may change between runs: drop our old local entries
        final Iterator<SharedConfig.ProxyInfo> it = SharedConfig.proxyList.iterator();
        while (it.hasNext()) {
            final SharedConfig.ProxyInfo p = it.next();
            if (p.settings.getType() == ProxySettings.Type.SOCKS5 && LOCAL.equals(p.settings.getAddress()) && user.equals(p.settings.getUser()) && !p.settings.equals(s)) {
                it.remove();
            }
        }
        final SharedConfig.ProxyInfo info = SharedConfig.addProxy(new SharedConfig.ProxyInfo(s));
        SharedConfig.currentProxy = info;
        final SharedPreferences.Editor e = MessagesController.getGlobalMainSettings().edit();
        s.toSharedPreferences(e);
        e.putBoolean("proxy_enabled", true);
        e.commit();
        SharedConfig.proxyRotationEnabled = true;
        SharedConfig.saveConfig();
        SharedConfig.saveProxyList();
        ConnectionsManager.setProxySettings(true, s);
        NotificationCenter.getGlobalInstance().postNotificationName(NotificationCenter.proxySettingsChanged);
    }

    private static void disableTelegramProxy() {
        final SharedPreferences.Editor e = MessagesController.getGlobalMainSettings().edit();
        e.putBoolean("proxy_enabled", false);
        e.commit();
        ConnectionsManager.setProxySettings(false, null);
        NotificationCenter.getGlobalInstance().postNotificationName(NotificationCenter.proxySettingsChanged);
    }

    private static SharedConfig.ProxyInfo firstMtproto() {
        SharedConfig.loadProxyList();
        for (SharedConfig.ProxyInfo p : SharedConfig.proxyList) {
            if (isOurMtproto(p)) {
                return p;
            }
        }
        return null;
    }

    /** Our MTProto proxies go into Telegram's proxy list once per list version (the user may delete them). */
    private static void addMtprotoFallbacks() {
        final JSONObject pj = profilesJson();
        final JSONArray list = Brand.array(pj, "mtproto");
        final String ver = pj.optString("version", "") + ":" + list.length();
        if (ver.equals(prefs.getString("mtproto_added", ""))) {
            return;
        }
        for (int i = list.length() - 1; i >= 0; i--) {
            final JSONObject o = list.optJSONObject(i);
            if (o == null || o.optString("server").isEmpty() || o.optString("secret").isEmpty()) {
                continue;
            }
            SharedConfig.addProxy(new SharedConfig.ProxyInfo(ProxySettings.builder().setType(ProxySettings.Type.MTPROTO)
                    .setAddress(o.optString("server")).setPort(o.optInt("port", 443)).setSecret(o.optString("secret")).build()));
        }
        prefs.edit().putString("mtproto_added", ver).apply();
    }

    // ------------------------------------------------------------------ profiles

    /** brand.json bypass, replaced by the last list downloaded from profiles_url when there is one. */
    static JSONObject profilesJson() {
        try {
            final File f = new File(dir(), "profiles.json");
            if (f.length() > 2) {
                final JSONObject o = new JSONObject(Brand.readAll(new java.io.FileInputStream(f)));
                if (o.optJSONArray("xray") != null && o.optJSONArray("xray").length() > 0) {
                    return o;
                }
            }
        } catch (Throwable ignore) {
        }
        return Brand.bypass();
    }

    private static ArrayList<JSONObject> outbounds() {
        final ArrayList<JSONObject> out = new ArrayList<>();
        final JSONArray a = Brand.array(profilesJson(), "xray");
        for (int i = 0; i < a.length(); i++) {
            final JSONObject o = a.optJSONObject(i);
            if (o != null && o.has("protocol")) {
                out.add(o);
            }
        }
        return out;
    }

    private static void refreshProfiles() {
        final String url = Brand.bypass().optString("profiles_url", "");
        if (url.isEmpty() || System.currentTimeMillis() - prefs.getLong("profiles_at", 0) < 12 * 3600_000L) {
            return;
        }
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setRequestProperty("User-Agent", Brand.name + "/" + ApplicationLoader.applicationContext.getPackageManager()
                    .getPackageInfo(ctx.getPackageName(), 0).versionName);
            if (c.getResponseCode() == 200) {
                final String body = Brand.readAll(c.getInputStream());
                final JSONObject o = new JSONObject(body);
                if (o.optJSONArray("xray") != null) {
                    final File f = new File(dir(), "profiles.json");
                    try (FileOutputStream fo = new FileOutputStream(f)) {
                        fo.write(body.getBytes(StandardCharsets.UTF_8));
                    }
                    prefs.edit().putLong("profiles_at", System.currentTimeMillis()).apply();
                }
            }
        } catch (Throwable e) {
            note("profiles: " + e.getClass().getSimpleName());
        } finally {
            if (c != null) {
                c.disconnect();
            }
        }
    }

    // ------------------------------------------------------------------ xray core

    private static File dir() {
        final File d = new File(ctx.getFilesDir(), "tgx");
        if (!d.exists()) {
            d.mkdirs();
        }
        return d;
    }

    private static boolean alive(Process p) {
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    private static synchronized boolean startXraySafe() {
        try {
            return startXray();
        } catch (Throwable e) {
            lastError = e.getClass().getSimpleName() + ": " + e.getMessage();
            note("xray: " + lastError);
            return false;
        }
    }

    private static synchronized boolean startXray() throws Exception {
        if (xray != null && alive(xray) && portOpen(port)) {
            return true;
        }
        stopXray();
        final ArrayList<JSONObject> obs = outbounds();
        if (obs.isEmpty()) {
            lastError = "no xray profiles";
            return false;
        }
        final File bin = new File(ctx.getApplicationInfo().nativeLibraryDir, "libxray.so");
        if (!bin.exists()) {
            lastError = "no xray core for this CPU";
            return false;
        }
        port = prefs.getInt("port", 0);
        if (port == 0 || portOpen(port)) {
            port = 20000 + new SecureRandom().nextInt(40000);
            prefs.edit().putInt("port", port).apply();
        }
        final File cfg = new File(dir(), "xray.json");
        try (FileOutputStream fo = new FileOutputStream(cfg)) {
            fo.write(config(obs).toString().getBytes(StandardCharsets.UTF_8));
        }
        cfg.setReadable(false, false);
        cfg.setReadable(true, true);
        final ProcessBuilder pb = new ProcessBuilder(bin.getAbsolutePath(), "run", "-c", cfg.getAbsolutePath());
        pb.directory(dir());
        pb.redirectErrorStream(true);
        pb.environment().put("XRAY_LOCATION_ASSET", dir().getAbsolutePath());
        final Process p = pb.start();
        xray = p;
        final Thread reader = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null) {
                    note("xray: " + line);
                }
            } catch (Throwable ignore) {
            }
        }, "tgx-xray-log");
        reader.setDaemon(true);
        reader.start();
        for (int i = 0; i < 40; i++) {
            if (portOpen(port)) {
                lastError = "";
                note("xray up on " + port + ", outbounds " + obs.size());
                return true;
            }
            if (!alive(p)) {
                break;
            }
            Thread.sleep(100);
        }
        lastError = "xray did not start";
        return false;
    }

    private static synchronized void stopXray() {
        if (xray != null) {
            try {
                xray.destroy();
            } catch (Throwable ignore) {
            }
            xray = null;
        }
    }

    private static boolean portOpen(int p) {
        if (p <= 0) {
            return false;
        }
        try (Socket s = new Socket()) {
            s.connect(new InetSocketAddress(LOCAL, p), 300);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    /** SOCKS5 with login (other apps on the phone cannot use it), UDP for calls, least-ping balancer over all profiles. */
    static JSONObject config(ArrayList<JSONObject> obs) throws Exception {
        final JSONObject c = new JSONObject();
        c.put("log", new JSONObject().put("loglevel", "warning"));
        final JSONObject socks = new JSONObject()
                .put("tag", "in").put("listen", LOCAL).put("port", port).put("protocol", "socks")
                .put("settings", new JSONObject().put("auth", "password").put("udp", true).put("ip", LOCAL)
                        .put("accounts", new JSONArray().put(new JSONObject().put("user", user).put("pass", pass))));
        c.put("inbounds", new JSONArray().put(socks));
        final JSONArray outs = new JSONArray();
        final JSONArray tags = new JSONArray();
        for (int i = 0; i < obs.size(); i++) {
            final JSONObject o = new JSONObject(obs.get(i).toString());
            final String tag = "px-" + i;
            o.put("tag", tag);
            resolveAddresses(o);
            outs.put(o);
            tags.put(tag);
        }
        outs.put(new JSONObject().put("tag", "block").put("protocol", "blackhole"));
        c.put("outbounds", outs);
        final JSONObject routing = new JSONObject().put("domainStrategy", "AsIs");
        if (obs.size() > 1) {
            routing.put("balancers", new JSONArray().put(new JSONObject().put("tag", "bal").put("selector", new JSONArray().put("px-"))
                    .put("strategy", new JSONObject().put("type", "leastPing"))));
            routing.put("rules", new JSONArray().put(new JSONObject().put("type", "field").put("inboundTag", new JSONArray().put("in")).put("balancerTag", "bal")));
            c.put("observatory", new JSONObject().put("subjectSelector", new JSONArray().put("px-"))
                    .put("probeUrl", "https://www.gstatic.com/generate_204").put("probeInterval", "3m").put("enableConcurrency", true));
        } else {
            routing.put("rules", new JSONArray().put(new JSONObject().put("type", "field").put("inboundTag", new JSONArray().put("in")).put("outboundTag", "px-0")));
        }
        c.put("routing", routing);
        c.put("dns", new JSONObject().put("servers", new JSONArray().put("1.1.1.1").put("8.8.8.8").put("77.88.8.8")));
        return c;
    }

    /** Android has no /etc/resolv.conf for the Go resolver: server names are resolved here (SNI stays the name). */
    private static void resolveAddresses(JSONObject outbound) {
        final JSONObject s = outbound.optJSONObject("settings");
        if (s == null) {
            return;
        }
        for (String key : new String[]{"vnext", "servers"}) {
            final JSONArray a = s.optJSONArray(key);
            if (a == null) {
                continue;
            }
            for (int i = 0; i < a.length(); i++) {
                final JSONObject srv = a.optJSONObject(i);
                if (srv == null) {
                    continue;
                }
                final String host = srv.optString("address", "");
                if (host.isEmpty() || host.matches("[0-9.]+") || host.contains(":")) {
                    continue;
                }
                try {
                    for (InetAddress ia : InetAddress.getAllByName(host)) {
                        if (ia instanceof java.net.Inet4Address) {
                            srv.put("address", ia.getHostAddress());
                            break;
                        }
                    }
                } catch (Throwable ignore) {
                    // xray tries its own DNS (dns.servers) with domainStrategy below
                    try {
                        final JSONObject ss = outbound.optJSONObject("streamSettings") != null ? outbound.optJSONObject("streamSettings") : new JSONObject();
                        final JSONObject so = ss.optJSONObject("sockopt") != null ? ss.optJSONObject("sockopt") : new JSONObject();
                        so.put("domainStrategy", "UseIPv4");
                        ss.put("sockopt", so);
                        outbound.put("streamSettings", ss);
                    } catch (Throwable ignore2) {
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------ misc

    static synchronized void note(String s) {
        final String line = String.format(Locale.US, "%tT %s", System.currentTimeMillis(), s);
        log.addLast(line);
        while (log.size() > 60) {
            log.removeFirst();
        }
        FileLog.d("tgx " + s);
        android.util.Log.i("tgx", s);
    }

    private static String randomHex(int bytes) {
        final byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        final StringBuilder sb = new StringBuilder();
        for (byte x : b) {
            sb.append(String.format(Locale.US, "%02x", x));
        }
        return sb.toString();
    }

    private static boolean isMainProcess(Context c) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 28) {
                return c.getPackageName().equals(android.app.Application.getProcessName());
            }
            final android.app.ActivityManager am = (android.app.ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
            final int pid = android.os.Process.myPid();
            for (android.app.ActivityManager.RunningAppProcessInfo i : am.getRunningAppProcesses()) {
                if (i.pid == pid) {
                    return c.getPackageName().equals(i.processName);
                }
            }
        } catch (Throwable ignore) {
        }
        return true;
    }

    public static void runOnUi(Runnable r) {
        AndroidUtilities.runOnUIThread(r);
    }
}
