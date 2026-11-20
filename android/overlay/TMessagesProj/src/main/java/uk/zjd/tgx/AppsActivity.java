/*
 * Cloud Gram / Vice Gram — unofficial Telegram client by CloudVPN.
 * Licensed under GNU GPL v. 2 or later, like the Telegram for Android sources it is based on.
 */
package uk.zjd.tgx;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.telegram.messenger.R;
import org.telegram.ui.ActionBar.ActionBar;
import org.telegram.ui.ActionBar.BaseFragment;
import org.telegram.ui.ActionBar.Theme;

/**
 * Settings → «Vice apps» / «Наши приложения»: the shared plates of the design kit (cv-apps.js, cv-ads.js) on a local
 * page. Outside chats on purpose: no plates in the chat list or in conversations.
 */
public class AppsActivity extends BaseFragment {
    private WebView web;

    public static String title() {
        return Brand.isVice() ? "Vice apps" : Brand.t("Наши приложения", "Our apps");
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    public View createView(Context context) {
        actionBar.setBackButtonImage(R.drawable.ic_ab_back);
        actionBar.setAllowOverlayTitle(true);
        actionBar.setTitle(title());
        actionBar.setActionBarMenuOnItemClick(new ActionBar.ActionBarMenuOnItemClick() {
            @Override
            public void onItemClick(int id) {
                if (id == -1) {
                    finishFragment();
                }
            }
        });
        web = new WebView(context);
        web.setBackgroundColor(Theme.getColor(Theme.key_windowBackgroundWhite));
        final WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                final Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) {
                    return false;
                }
                try {
                    view.getContext().startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Throwable ignore) {
                }
                return true;
            }
        });
        final boolean dark = Theme.isCurrentThemeDark();
        final String theme = Brand.isVice() ? (dark ? "vice-night" : "vice-day") : (dark ? "dark" : "light");
        web.loadUrl("file:///android_asset/tgx/apps.html?line=" + Brand.line + "&theme=" + theme
                + "&slot=" + Uri.encode(Brand.json.optString("ads_slot", "gram.settings"))
                + "&current=" + Uri.encode(Brand.product) + "&lang=" + (Brand.ru() ? "ru" : "en"));
        fragmentView = web;
        return fragmentView;
    }

    @Override
    public void onFragmentDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onFragmentDestroy();
    }
}
