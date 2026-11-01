package top.aoikjuice.zjuallinone;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.TextUtils;
import android.util.Base64;
import android.webkit.CookieManager;
import androidx.core.content.FileProvider;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * 安卓端的"主进程"能力（对应 src/mobile/native.ts）：
 * 请求不自动跟随跳转（由 JS 逐跳处理并记下落点），cookie 读写系统 CookieManager（与 WebView 共用，video / img 也带上登录态）；
 * 凭据用 Android Keystore 的 AES-GCM 加密后存 SharedPreferences；下载写进系统"下载/ZJU All in One"。
 */
@CapacitorPlugin(name = "ZjuNative")
public class ZjuNativePlugin extends Plugin {

    // 与桌面端 Electron 一致的桌面 UA：部分校内站点对手机 UA 返回另一套页面
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    private static final String KEY_ALIAS = "zju-secrets";
    private static final String PREFS = "zju-secure";
    private static final String FOLDER = "ZJU All in One";
    private static final int LARGE_BODY = 256 * 1024;

    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    private HttpURLConnection open(String url, String method, JSObject headers) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(false);
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", UA);
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
        if (headers != null) {
            Iterator<String> keys = headers.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                c.setRequestProperty(k, headers.getString(k));
            }
        }
        return c;
    }

    /** 读响应头：Set-Cookie 写进 CookieManager，其余以小写键返回 */
    private JSObject headersOf(HttpURLConnection c, String url) {
        JSObject h = new JSObject();
        CookieManager cm = CookieManager.getInstance();
        for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
            if (e.getKey() == null) continue;
            String k = e.getKey().toLowerCase(Locale.ROOT);
            if (k.equals("set-cookie")) {
                for (String v : e.getValue()) cm.setCookie(url, v);
            } else {
                h.put(k, TextUtils.join(", ", e.getValue()));
            }
        }
        cm.flush();
        return h;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        if (in == null) return new byte[0];
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = s.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private static InputStream bodyOf(HttpURLConnection c, int status) {
        try {
            return status >= 400 ? c.getErrorStream() : c.getInputStream();
        } catch (Exception e) {
            return null;
        }
    }

    private static String message(Exception e) {
        return e.getMessage() == null ? e.toString() : e.getMessage();
    }

    @PluginMethod
    public void request(PluginCall call) {
        pool.execute(() -> {
            try {
                String url = call.getString("url");
                HttpURLConnection c = open(url, call.getString("method", "GET"), call.getObject("headers"));
                byte[] body = null;
                if (call.getString("bodyBase64") != null) body = Base64.decode(call.getString("bodyBase64"), Base64.DEFAULT);
                else if (call.getString("body") != null) body = call.getString("body").getBytes(StandardCharsets.UTF_8);
                if (body != null) {
                    c.setDoOutput(true);
                    c.setFixedLengthStreamingMode(body.length);
                    try (OutputStream o = c.getOutputStream()) {
                        o.write(body);
                    }
                }
                int status = c.getResponseCode();
                JSObject out = new JSObject();
                out.put("status", status);
                out.put("headers", headersOf(c, url));
                byte[] data = readAll(bodyOf(c, status));
                if (call.getBoolean("binary", false)) {
                    out.put("base64", Base64.encodeToString(data, Base64.NO_WRAP));
                } else if (data.length > LARGE_BODY) {
                    // 大响应（如智云整节课的文字稿）不经桥传字符串：写进缓存文件，网页按本地地址读取后调 release 删掉
                    File file = File.createTempFile("response", ".txt", getContext().getCacheDir());
                    try (OutputStream o = new FileOutputStream(file)) {
                        o.write(data);
                    }
                    out.put("file", file.getAbsolutePath());
                } else {
                    out.put("body", new String(data, StandardCharsets.UTF_8));
                }
                c.disconnect();
                call.resolve(out);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    @PluginMethod
    public void release(PluginCall call) {
        File file = new File(call.getString("file", ""));
        if (file.getParentFile() != null && file.getParentFile().equals(getContext().getCacheDir())) file.delete();
        call.resolve();
    }

    @PluginMethod
    public void cookies(PluginCall call) {
        String value = CookieManager.getInstance().getCookie(call.getString("url"));
        JSObject out = new JSObject();
        out.put("value", value == null ? "" : value);
        call.resolve(out);
    }

    /** 不给 hosts 时清空全部；给了只让这些站点下看得到的 cookie 过期（PTA 退出时不影响统一身份认证） */
    @PluginMethod
    public void clearCookies(PluginCall call) {
        CookieManager cm = CookieManager.getInstance();
        JSArray hosts = call.getArray("hosts");
        if (hosts == null) {
            cm.removeAllCookies(done -> {
                cm.flush();
                call.resolve();
            });
            return;
        }
        try {
            for (String host : hosts.<String>toList()) {
                String url = "https://" + host;
                String all = cm.getCookie(url);
                if (all == null) continue;
                String[] labels = host.split("\\.");
                String parent = labels.length >= 2 ? labels[labels.length - 2] + "." + labels[labels.length - 1] : host;
                for (String part : all.split(";")) {
                    String name = part.split("=", 2)[0].trim();
                    if (name.isEmpty()) continue;
                    cm.setCookie(url, name + "=; Max-Age=0; Path=/");
                    cm.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=" + host);
                    cm.setCookie(url, name + "=; Max-Age=0; Path=/; Domain=." + parent);
                }
            }
            cm.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (!ks.containsAlias(KEY_ALIAS)) {
            KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            g.init(
                new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            );
            g.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] sealed = cipher.doFinal(call.getString("value", "").getBytes(StandardCharsets.UTF_8));
            String stored = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(sealed, Base64.NO_WRAP);
            prefs().edit().putString(call.getString("key"), stored).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    /** 解不开（如换机恢复了数据但密钥不在）时当作没有 */
    @PluginMethod
    public void secureGet(PluginCall call) {
        JSObject out = new JSObject();
        String stored = prefs().getString(call.getString("key"), null);
        try {
            if (stored != null) {
                String[] parts = stored.split(":", 2);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                out.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
            } else {
                out.put("value", JSObject.NULL);
            }
        } catch (Exception e) {
            out.put("value", JSObject.NULL);
        }
        call.resolve(out);
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        prefs().edit().remove(call.getString("key")).apply();
        call.resolve();
    }

    /** 跟随跳转后流式写入"下载/ZJU All in One"，返回 content:// 地址 */
    @PluginMethod
    public void download(PluginCall call) {
        pool.execute(() -> {
            try {
                String url = call.getString("url");
                String name = call.getString("name", "download");
                HttpURLConnection c = null;
                for (int hop = 0; hop < 15; hop++) {
                    c = open(url, "GET", call.getObject("headers"));
                    int status = c.getResponseCode();
                    headersOf(c, url);
                    String location = c.getHeaderField("Location");
                    if (status >= 300 && status < 400 && location != null) {
                        url = new URL(new URL(url), location).toString().replaceFirst("^http://([^/]*\\.zju\\.edu\\.cn)", "https://$1");
                        c.disconnect();
                        continue;
                    }
                    if (status >= 400) throw new Exception("下载失败（" + status + "）");
                    break;
                }
                String mime = URLConnection.guessContentTypeFromName(name);
                if (mime == null) mime = c.getContentType() != null ? c.getContentType().split(";")[0] : "application/octet-stream";
                Uri uri = save(name, mime, c.getInputStream());
                c.disconnect();
                JSObject out = new JSObject();
                out.put("uri", uri.toString());
                call.resolve(out);
            } catch (Exception e) {
                call.reject(message(e));
            }
        });
    }

    private Uri save(String name, String mime, InputStream in) throws Exception {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentResolver resolver = ctx.getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, name);
            values.put(MediaStore.Downloads.MIME_TYPE, mime);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
            values.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("无法写入下载目录");
            try (InputStream s = in; OutputStream out = resolver.openOutputStream(uri)) {
                copy(s, out);
            }
            values.clear();
            values.put(MediaStore.Downloads.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        }
        File dir = new File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), FOLDER);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("无法写入下载目录");
        File file = new File(dir, name);
        try (InputStream s = in; OutputStream out = new FileOutputStream(file)) {
            copy(s, out);
        }
        return FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);
    }

    private static void copy(InputStream in, OutputStream out) throws Exception {
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }

    /** 用其他应用打开下载的文件 */
    @PluginMethod
    public void open(PluginCall call) {
        try {
            Uri uri = Uri.parse(call.getString("uri"));
            String mime = getContext().getContentResolver().getType(uri);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime != null ? mime : "*/*");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(Intent.createChooser(intent, null));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("没有能打开此文件的应用");
        } catch (Exception e) {
            call.reject(message(e));
        }
    }

    /** 播放器全屏：横屏并隐藏系统栏（Capacitor 的 WebView 不支持网页的 requestFullscreen） */
    @PluginMethod
    public void immersive(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(
                on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            );
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                bars.show(WindowInsetsCompat.Type.systemBars());
            }
            call.resolve();
        });
    }
}
