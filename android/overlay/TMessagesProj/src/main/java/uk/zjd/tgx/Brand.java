/*
 * Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN.
 * Licensed under GNU GPL v. 2 or later, like the Telegram for Android sources it is based on.
 */
package uk.zjd.tgx;

import android.content.Context;
import android.text.TextUtils;

import org.json.JSONArray;
import org.json.JSONObject;
import org.telegram.messenger.BuildVars;
import org.telegram.messenger.R;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;

/**
 * Line and settings of this build: assets/brand.json.
 * <pre>
 * {"v":1, "brand":"cloud"|"vice", "name":"Cloud Gram", "product":"gram", "theme":"",
 *  "api_id":0, "api_hash":"",                       — written at signing time, never in the public repository
 *  "bypass":{"mode":"auto", "profiles_url":"", "xray":[ outbound… ], "mtproto":[{"server","port","secret"}…]},
 *  "downloads":"https://cabinet.zjd.uk/app/downloads.json", "ads_slot":"gram.settings"}
 * </pre>
 * The Vice APK is the Cloud APK with another brand.json and launcher alias (tools/brand_apk.py), same key.
 */
public final class Brand {
    public static String line = "cloud";
    public static String name = "Cloud Gram";
    public static String product = "gram";
    public static String theme = "";
    public static JSONObject json = new JSONObject();
    private static boolean loaded;

    private Brand() {
    }

    public static synchronized void init(Context ctx) {
        if (loaded || ctx == null) {
            return;
        }
        loaded = true;
        try (InputStream in = ctx.getAssets().open("brand.json")) {
            json = new JSONObject(readAll(in));
        } catch (Throwable ignore) {
            json = new JSONObject();
        }
        line = "vice".equals(json.optString("brand")) ? "vice" : "cloud";
        name = json.optString("name", isVice() ? "Vice Gram" : "Cloud Gram");
        product = json.optString("product", isVice() ? "vice-gram" : "gram");
        theme = json.optString("theme", "");
        final int id = json.optInt("api_id", 0);
        final String hash = json.optString("api_hash", "");
        if (id > 0 && hash.length() == 32) {
            BuildVars.APP_ID = id;
            BuildVars.APP_HASH = hash;
        }
    }

    public static boolean isVice() {
        return "vice".equals(line);
    }

    /** api_id is set: without it the client must not talk to Telegram (no fallback to official keys). */
    public static boolean hasApiKeys() {
        return BuildVars.APP_ID > 0 && !TextUtils.isEmpty(BuildVars.APP_HASH);
    }

    public static JSONObject bypass() {
        final JSONObject b = json.optJSONObject("bypass");
        return b != null ? b : new JSONObject();
    }

    public static JSONArray array(JSONObject o, String key) {
        final JSONArray a = o.optJSONArray(key);
        return a != null ? a : new JSONArray();
    }

    public static boolean ru() {
        final String l = Locale.getDefault().getLanguage();
        return "ru".equals(l) || "uk".equals(l) || "be".equals(l) || "kk".equals(l);
    }

    public static String t(String ru, String en) {
        return ru() ? ru : en;
    }

    /** Strings that would call the app «Telegram». Everything else (the service name) stays as is. */
    public static String override(String key, int res) {
        if (res == R.string.Page1Message || "Page1Message".equals(key)) {
            // Telegram API terms 2.2: the intro says that this is an unofficial client on the Telegram API
            return t("**Неофициальный** клиент Telegram от CloudVPN.\nВстроенный **обход блокировок**.",
                    "**Unofficial** Telegram client by CloudVPN.\nWith a built-in **bypass of blocks**.");
        }
        if (res != 0) {
            if (res == R.string.AppName || res == R.string.AppNameBeta || res == R.string.Page1Title) {
                return name;
            }
        } else if (key != null) {
            if ("AppName".equals(key) || "AppNameBeta".equals(key) || "Page1Title".equals(key)) {
                return name;
            }
        }
        return null;
    }

    static String readAll(InputStream in) throws java.io.IOException {
        final ByteArrayOutputStream out = new ByteArrayOutputStream();
        final byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
        return out.toString("UTF-8");
    }
}
