// 앱 화면: Capacitor 화면에 앱 안 플러그인(DgoAuth: 카카오 로그인 창·애플 로그인)을 등록한다
import UIKit
import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DgoAuthPlugin())
    }
}
