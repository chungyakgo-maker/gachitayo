// 앱 화면: Capacitor 화면에 앱 안 플러그인(DgoAuth: 카카오 로그인 창·애플 로그인, DgoTabBar: 아래 탭 유리 알약)을 등록한다
import UIKit
import WebKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    /// 아래 탭 유리 알약 (1.0.2~, NativeTabBar.swift). 사이트가 DgoTabBar 플러그인으로 고른 탭·보일지를 알려 준다
    let nativeTabs = NativeTabBar()

    override func viewDidLoad() {
        super.viewDidLoad()
        nativeTabs.attach(to: view, page: webView)
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DgoAuthPlugin())
        bridge?.registerPluginInstance(DgoTabBarPlugin())
        // 사이트에 "이 앱은 아래 탭을 아이폰 유리 알약으로 그린다"고 알리는 표시 — 페이지를 그리기 전에 html 에 native-tabs 를 붙인다.
        // 이 표시가 있을 때만 사이트 탭이 투명해진다 (웹은 사이트 탭 그대로)
        let mark = WKUserScript(source: "document.documentElement.classList.add('native-tabs')", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(mark)
    }
}
