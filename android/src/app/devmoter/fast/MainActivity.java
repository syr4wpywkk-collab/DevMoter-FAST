package app.devmoter.fast;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.net.URI;

public final class MainActivity extends Activity {
    private static final int CHOOSE_FILE = 40;
    private LinearLayout root;
    private WebView web;
    private TextView status;
    private String origin;
    private ValueCallback<Uri[]> pendingFiles;
    private boolean switching;

    static String validatedOrigin(String value) {
        try {
            URI u = new URI(value.trim());
            if (!"https".equalsIgnoreCase(u.getScheme()) || u.getHost() == null ||
                u.getRawUserInfo() != null || u.getRawQuery() != null ||
                u.getRawFragment() != null || u.getPort() == 0 || u.getPort() > 65535 ||
                !(u.getRawPath().isEmpty() || "/".equals(u.getRawPath()))) return null;
            int port = u.getPort() == 443 ? -1 : u.getPort();
            return new URI("https", null, u.getHost().toLowerCase(java.util.Locale.ROOT), port, null, null, null).toASCIIString();
        } catch (Exception e) { return null; }
    }

    private boolean sameOrigin(Uri url) {
        if (origin == null || url == null) return false;
        try {
            URI u = new URI(url.toString());
            URI base = new URI(origin);
            int port = u.getPort() == -1 ? 443 : u.getPort();
            int basePort = base.getPort() == -1 ? 443 : base.getPort();
            return "https".equalsIgnoreCase(u.getScheme()) && u.getRawUserInfo() == null &&
                u.getHost() != null && u.getHost().equalsIgnoreCase(base.getHost()) && port == basePort;
        } catch (Exception e) { return false; }
    }

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        origin = validatedOrigin(getPreferences(MODE_PRIVATE).getString("origin", ""));
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() |
                    WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
            getWindow().getInsetsController().setSystemBarsAppearance(
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        setContentView(root);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        Button connect = new Button(this); connect.setText("接続先");
        connect.setOnClickListener(v -> connectionDialog());
        toolbar.addView(connect);
        Button reload = new Button(this); reload.setText("再読込");
        reload.setOnClickListener(v -> { if (web != null && !switching && origin != null) {
            status.setVisibility(View.GONE); web.reload();
        }});
        toolbar.addView(reload);
        TextView name = new TextView(this); name.setText("DevMoter FAST");
        name.setGravity(android.view.Gravity.CENTER_VERTICAL);
        toolbar.addView(name, new LinearLayout.LayoutParams(0, -1, 1));
        root.addView(toolbar);
        status = new TextView(this); status.setPadding(16, 12, 16, 12);
        root.addView(status);
        newWebView();
        if (origin == null) { showStatus("HTTPSのDevMoterサーバーを登録してください。"); connectionDialog(); }
        else loadHome();
    }

    private void showStatus(String message) {
        status.setText(message); status.setVisibility(View.VISIBLE);
    }

    private void loadHome() {
        status.setVisibility(View.GONE);
        web.loadUrl(origin + "/");
    }

    private void connectionDialog() {
        if (switching) return;
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setHint("https://your-server.example");
        if (origin != null) address.setText(origin);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("DevMoter接続先")
            .setMessage("HTTPSのオリジンのみ。接続先を変更すると端末内のWebセッションを消去します。")
            .setView(address).setNegativeButton("キャンセル", null)
            .setPositiveButton("接続", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String next = validatedOrigin(address.getText().toString());
            if (next == null) { address.setError("有効なHTTPSアドレスを入力してください"); return; }
            dialog.dismiss();
            if (next.equals(origin)) { loadHome(); return; }
            switching = true;
            destroyWebView();
            WebStorage.getInstance().deleteAllData();
            CookieManager.getInstance().removeAllCookies(removed -> {
                CookieManager.getInstance().flush();
                if (isFinishing() || isDestroyed()) return;
                origin = next;
                getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply();
                newWebView();
                switching = false;
                loadHome();
            });
        }));
        dialog.show();
    }

    @SuppressWarnings("deprecation")
    private void newWebView() {
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (sameOrigin(uri)) return false;
                if (!request.isForMainFrame()) return true;
                if (request.hasGesture() && "https".equalsIgnoreCase(uri.getScheme())) {
                    try {
                        URI parsed = new URI(uri.toString());
                        if (parsed.getHost() != null && parsed.getRawUserInfo() == null) {
                            new AlertDialog.Builder(MainActivity.this).setTitle("外部ブラウザで開く")
                                .setMessage(parsed.getHost())
                                .setNegativeButton("キャンセル", null)
                                .setPositiveButton("開く", (d, w) -> {
                                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                                    catch (Exception e) { showStatus("外部ブラウザを開けません。"); }
                                }).show();
                        }
                    } catch (Exception ignored) { }
                } else showStatus("接続先以外への移動をブロックしました。");
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (view != web || !sameOrigin(Uri.parse(url))) {
                    view.stopLoading();
                    showStatus("許可されていないページへの移動を停止しました。");
                }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showStatus("TLS証明書を検証できません。サーバーのHTTPS設定を確認してください。");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showStatus("接続に失敗しました。ネットワークとサーバーを確認してください。");
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
                if (view != web || !sameOrigin(Uri.parse(view.getUrl() == null ? "" : view.getUrl())) ||
                    !host.equalsIgnoreCase(Uri.parse(origin).getHost())) { handler.cancel(); return; }
                LinearLayout form = new LinearLayout(MainActivity.this); form.setOrientation(LinearLayout.VERTICAL);
                EditText user = new EditText(MainActivity.this); user.setHint("ユーザー名");
                user.setInputType(InputType.TYPE_CLASS_TEXT);
                EditText pass = new EditText(MainActivity.this); pass.setHint("パスワード");
                pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                form.addView(user); form.addView(pass);
                AlertDialog dialog = new AlertDialog.Builder(MainActivity.this)
                    .setTitle("サーバー認証: " + origin).setView(form)
                    .setNegativeButton("キャンセル", (d,w) -> handler.cancel())
                    .setPositiveButton("ログイン", (d,w) -> {
                        if (view == web && !switching) handler.proceed(user.getText().toString(), pass.getText().toString());
                        else handler.cancel();
                        pass.setText("");
                    }).create();
                dialog.setOnCancelListener(d -> handler.cancel());
                dialog.show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (view != web || view.getUrl() == null || !sameOrigin(Uri.parse(view.getUrl()))) {
                    callback.onReceiveValue(null); return true;
                }
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    Intent chooser = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                    chooser.setType("*/*");
                    chooser.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(chooser, CHOOSE_FILE);
                } catch (Exception e) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) ->
            Toast.makeText(this, "この試験版はダウンロード未対応です。", Toast.LENGTH_LONG).show());
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != CHOOSE_FILE || pendingFiles == null) return;
        ValueCallback<Uri[]> callback = pendingFiles; pendingFiles = null;
        Uri[] uris = WebChromeClient.FileChooserParams.parseResult(result, data);
        if (result != RESULT_OK || uris == null || web == null || web.getUrl() == null ||
            !sameOrigin(Uri.parse(web.getUrl()))) { callback.onReceiveValue(null); return; }
        for (Uri uri : uris) {
            if (uri == null || !"content".equals(uri.getScheme()) ||
                (getPackageName() + ".fileprovider").equals(uri.getAuthority())) {
                callback.onReceiveValue(null); return;
            }
        }
        callback.onReceiveValue(uris);
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    private void destroyWebView() {
        if (pendingFiles != null) { pendingFiles.onReceiveValue(null); pendingFiles = null; }
        if (web != null) {
            web.stopLoading(); web.clearHistory(); web.clearCache(true);
            root.removeView(web); web.destroy(); web = null;
        }
    }

    @Override protected void onDestroy() {
        destroyWebView(); super.onDestroy();
    }
}
