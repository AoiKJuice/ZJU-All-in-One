package top.aoikjuice.zjuallinone;

import android.os.Bundle;
import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZjuNativePlugin.class);
        super.onCreate(savedInstanceState);
        // 回放视频、课件图在 cmc 子域，与页面源同属 zju.edu.cn；保险起见放行第三方 cookie
        CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    }
}
