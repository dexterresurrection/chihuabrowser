/*
 * Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN.
 * Licensed under GNU GPL v. 2 or later, like the Telegram for Android sources it is based on.
 */
package uk.zjd.tgx;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;
import org.telegram.messenger.AndroidUtilities;
import org.telegram.ui.ActionBar.AlertDialog;

import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updates from our downloads.json (same file as the bot «📲 Приложения» and the cabinet), product = brand.json
 * «product». The APK is opened in the browser through get.html, like the other apps; mirrors in the same order as the
 * bot: GitHub, RU mirror (bucket), our server.
 */
public final class Updater {
    private static final String DEFAULT = "https://cabinet.zjd.uk/app/downloads.json";
    private static final String GET = "https://cabinet.zjd.uk/app/get.html?u=";
    private static boolean checking;

    private Updater() {
    }

    public static void check(Activity activity, boolean force) {
        if (activity == null || checking) {
            return;
        }
        final SharedPreferences p = activity.getSharedPreferences("tgx_update", Context.MODE_PRIVATE);
        if (!force && System.currentTimeMillis() - p.getLong("at", 0) < 6 * 3600_000L) {
            return;
        }
        checking = true;
        new Thread(() -> {
            try {
                final String url = Brand.json.optString("downloads", DEFAULT);
                final JSONObject d = new JSONObject(get(url));
                final JSONObject prod = d.getJSONObject("products").optJSONObject(Brand.product);
                p.edit().putLong("at", System.currentTimeMillis()).apply();
                if (prod == null) {
                    return;
                }
                final String latest = prod.optString("version");
                final String mine = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
                if (!newer(latest, ourVersion(mine)) || latest.equals(p.getString("skip", ""))) {
                    return;
                }
                final JSONObject file = pickFile(prod.optJSONArray("files"));
                if (file == null) {
                    return;
                }
                final String link = file.optString("github", file.optString("bucket", file.optString("server")));
                AndroidUtilities.runOnUIThread(() -> {
                    if (activity.isFinishing()) {
                        return;
                    }
                    new AlertDialog.Builder(activity)
                            .setTitle(Brand.t("Доступно обновление", "Update available"))
                            .setMessage(Brand.name + " " + latest + (prod.optString("notes").isEmpty() ? "" : "\n\n" + prod.optString("notes")))
                            .setPositiveButton(Brand.t("Скачать", "Download"), (dlg, w) -> {
                                try {
                                    activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(GET + Uri.encode(link))));
                                } catch (Throwable ignore) {
                                }
                            })
                            .setNegativeButton(Brand.t("Позже", "Later"), null)
                            .setNeutralButton(Brand.t("Пропустить", "Skip"), (dlg, w) -> p.edit().putString("skip", latest).apply())
                            .show();
                });
            } catch (Throwable ignore) {
            } finally {
                checking = false;
            }
        }, "tgx-update").start();
    }

    /** versionName is «13.2.2-cg.0.1.0» (Telegram base + ours): only our part is compared. */
    static String ourVersion(String versionName) {
        final int i = versionName.lastIndexOf("-cg.");
        return i >= 0 ? versionName.substring(i + 4) : versionName;
    }

    static boolean newer(String a, String b) {
        final String[] x = a.split("[.-]"), y = b.split("[.-]");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            final int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) {
                return p > q;
            }
        }
        return false;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Throwable e) {
            return 0;
        }
    }

    private static JSONObject pickFile(JSONArray files) {
        if (files == null) {
            return null;
        }
        JSONObject universal = null;
        final boolean arm64 = Build.SUPPORTED_64_BIT_ABIS.length > 0 && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0]);
        for (int i = 0; i < files.length(); i++) {
            final JSONObject f = files.optJSONObject(i);
            if (f == null || !f.optString("name").endsWith(".apk")) {
                continue;
            }
            final String flavor = f.optString("flavor");
            if (arm64 && flavor.endsWith("-arm64")) {
                return f;
            }
            if (flavor.endsWith("-universal") || universal == null) {
                universal = f;
            }
        }
        return universal;
    }

    private static String get(String url) throws Exception {
        final HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        try {
            return Brand.readAll(c.getInputStream());
        } finally {
            c.disconnect();
        }
    }
}
