// 아래 탭 유리 알약 — 아이폰 부품으로 그린다 (2026-11-20 세영 "하단 메뉴바 아이폰 SDK 유리 알약으로 바꿀거야 … 버튼 크기에 맞춰서
// 알약 가로 길이를 정해", 시안 docs/mock/2026-11-20-native-tabs.jpg, 메리고 1.0.2 방식). 1.0.2 부터. 웹은 사이트 탭 그대로.
// · iOS 26 은 애플 리퀴드 글래스(UIGlassEffect), 그 전 iOS 는 애플 기본 반투명 유리(UIBlurEffect). 디고는 어두운 화면이라 어두운 유리로 고정
// · 크기: 버튼 한 칸 70 × 54 고정, 안쪽 여백 4 → 알약 288 × 62. 양옆 여백은 고정하지 않고 (화면 너비 − 288) ÷ 2 (가운데).
//   아래 여백 max(10, 아래 안전 여백 − 18) — 홈 줄 아이폰 16, 홈 단추 아이폰 10. 사이트(styles.css --native-tab-h)도 같은 셈 — 바꾸면 둘 다
// · 사이트 탭(src/ui/components/TabBar.tsx)은 투명하게 자리만 남아 "지금 탭·보일 때인지"를 DgoTabBar.set 으로 알려 준다(바뀔 때 + 3초마다).
//   숨기는 때도 사이트가 정한다: 글자를 칠 때, 아래에서 올라오는 창이 덮을 때, 탭 화면이 아닐 때(주행·준비·상세)
// · 누르면 사이트에 dgo:native-tab 소식(탭 경로)을 보낸다 — 화면을 바꾸는 일은 사이트가 한다(사이트 탭을 누른 것과 같다)
import UIKit
import WebKit
import Capacitor

final class NativeTabBar {
    /// 탭 경로(사이트 app/nativeTabs.ts NATIVE_TAB_PATHS 와 같다) · 글자 · 아이폰 기본 아이콘(없는 iOS 15 는 대신 쓸 아이콘)
    private static let items: [(key: String, title: String, symbol: String, fallback: String)] = [
        ("/", "메인", "mappin.and.ellipse", "mappin.and.ellipse"),
        ("/courses", "코스", "point.topleft.down.curvedto.point.bottomright.up", "arrow.triangle.turn.up.right.diamond"),
        ("/history", "기록", "chart.xyaxis.line", "chart.bar"),
        ("/settings", "설정", "slider.horizontal.3", "slider.horizontal.3")
    ]
    /// 버튼 한 칸 (고정) · 안쪽 여백 → 알약 크기
    private static let cellW: CGFloat = 70
    private static let cellH: CGFloat = 54
    private static let pad: CGFloat = 4
    private static var pillW: CGFloat { cellW * CGFloat(items.count) + pad * 2 }
    private static var pillH: CGFloat { cellH + pad * 2 }
    // 사이트 색(src/ui/styles.css): 하늘색 --accent #AACAE6 ("주행 시작" 버튼) · 그 위 글자 --on-accent #0D1A26 · 안 고른 칸 --fg-2 #C9CDD2
    private static let accent = UIColor(red: 170 / 255, green: 202 / 255, blue: 230 / 255, alpha: 1)
    private static let onAccent = UIColor(red: 13 / 255, green: 26 / 255, blue: 38 / 255, alpha: 1)
    private static let dim = UIColor(red: 201 / 255, green: 205 / 255, blue: 210 / 255, alpha: 1)

    private let holder = UIView()
    private let glass: UIVisualEffectView
    private let pick = UIView()
    private var buttons: [UIButton] = []
    private weak var page: WKWebView?
    private weak var host: UIView?
    private var loadWatch: NSKeyValueObservation?
    private var tab = ""
    private var shown = false
    private var liquid = false

    init() {
        var effect: UIVisualEffect = UIBlurEffect(style: .systemUltraThinMaterialDark)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            let g = UIGlassEffect()
            g.isInteractive = true
            effect = g
            liquid = true
        }
        #endif
        glass = UIVisualEffectView(effect: effect)
    }

    func attach(to host: UIView, page: WKWebView?) {
        self.page = page
        self.host = host
        holder.isHidden = true
        holder.alpha = 0
        // 디고는 어두운 화면 — 폰이 밝은 모드여도 어두운 유리로
        holder.overrideUserInterfaceStyle = .dark
        host.addSubview(holder)

        glass.frame = holder.bounds
        glass.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        holder.addSubview(glass)
        if liquid {
            #if compiler(>=6.2)
            if #available(iOS 26.0, *) {
                glass.cornerConfiguration = .capsule()
            }
            #endif
        } else {
            // 예전 iOS: 어두운 반투명 유리 + 어두운 기운 한 겹 + 얇은 흰 테두리 + 아래 그림자
            glass.clipsToBounds = true
            glass.layer.cornerCurve = .continuous
            glass.layer.borderWidth = 0.5
            glass.layer.borderColor = UIColor(white: 1, alpha: 0.18).cgColor
            let wash = UIView(frame: glass.bounds)
            wash.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            wash.backgroundColor = UIColor(white: 0.12, alpha: 0.35)
            wash.isUserInteractionEnabled = false
            glass.contentView.addSubview(wash)
            holder.layer.shadowColor = UIColor.black.cgColor
            holder.layer.shadowOpacity = 0.45
            holder.layer.shadowRadius = 15
            holder.layer.shadowOffset = CGSize(width: 0, height: 8)
        }

        // 고른 칸 — 그 칸 크기 그대로 하늘색 캡슐
        pick.backgroundColor = Self.accent
        pick.isUserInteractionEnabled = false
        pick.layer.cornerCurve = .continuous
        pick.layer.shadowColor = Self.accent.cgColor
        pick.layer.shadowOpacity = 0.35
        pick.layer.shadowRadius = 4
        pick.layer.shadowOffset = CGSize(width: 0, height: 2)
        glass.contentView.addSubview(pick)

        for it in Self.items {
            let b = UIButton(type: .custom)
            var c = UIButton.Configuration.plain()
            c.image = UIImage(systemName: it.symbol) ?? UIImage(systemName: it.fallback)
            c.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20, weight: .medium)
            c.imagePlacement = .top
            c.imagePadding = 4
            c.contentInsets = .zero
            var title = AttributedString(it.title)
            title.font = UIFont.systemFont(ofSize: 12, weight: .semibold)
            c.attributedTitle = title
            c.baseForegroundColor = Self.dim
            b.configuration = c
            b.accessibilityLabel = it.title
            let key = it.key
            b.addAction(UIAction { [weak self] _ in self?.tapped(key) }, for: .touchUpInside)
            glass.contentView.addSubview(b)
            buttons.append(b)
        }

        // 페이지를 새로 받기 시작하면(새로 고침·업데이트) 일단 숨긴다 — 새 페이지가 다시 알려 줄 때까지
        loadWatch = page?.observe(\.isLoading, options: [.new]) { [weak self] web, _ in
            if web.isLoading {
                DispatchQueue.main.async { self?.setShown(false) }
            }
        }
    }

    /// 사이트가 알려 준 대로 — 고른 칸, 보일지
    func apply(tab: String, show: Bool) {
        let f = frameNow()
        let ok = show && f != nil
        if let f = f, holder.frame != f {
            holder.frame = f
            layout()
        }
        select(tab, animated: shown && ok)
        setShown(ok)
    }

    /// 알약 288 × 62 를 가운데 — 양옆 여백은 남는 만큼, 아래 여백 max(10, 아래 안전 여백 − 18)
    private func frameNow() -> CGRect? {
        guard let host = host, host.bounds.width >= Self.pillW else { return nil }
        let bottom = max(10, host.safeAreaInsets.bottom - 18)
        return CGRect(x: ((host.bounds.width - Self.pillW) / 2).rounded(), y: host.bounds.height - bottom - Self.pillH, width: Self.pillW, height: Self.pillH)
    }

    private func layout() {
        let b = holder.bounds
        if !liquid {
            glass.layer.cornerRadius = b.height / 2
            holder.layer.shadowPath = UIBezierPath(roundedRect: b, cornerRadius: b.height / 2).cgPath
        }
        for (i, btn) in buttons.enumerated() {
            btn.frame = CGRect(x: Self.pad + Self.cellW * CGFloat(i), y: Self.pad, width: Self.cellW, height: Self.cellH)
        }
        placePick()
    }

    private func placePick() {
        guard let i = Self.items.firstIndex(where: { $0.key == tab }), i < buttons.count else {
            pick.isHidden = true
            return
        }
        pick.isHidden = false
        pick.frame = buttons[i].frame
        pick.layer.cornerRadius = pick.bounds.height / 2
    }

    private func select(_ key: String, animated: Bool) {
        guard key != tab else { return }
        tab = key
        for (i, b) in buttons.enumerated() {
            let on = Self.items[i].key == key
            var c = b.configuration
            c?.baseForegroundColor = on ? Self.onAccent : Self.dim
            b.configuration = c
            b.accessibilityTraits = on ? [.button, .selected] : [.button]
        }
        if animated {
            UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.8, initialSpringVelocity: 0, options: [.beginFromCurrentState], animations: {
                self.placePick()
            })
        } else {
            placePick()
        }
    }

    private func setShown(_ on: Bool) {
        guard on != shown else { return }
        shown = on
        if on {
            holder.isHidden = false
        }
        UIView.animate(withDuration: 0.15, delay: 0, options: [.beginFromCurrentState], animations: {
            self.holder.alpha = on ? 1 : 0
        }, completion: { _ in
            if !self.shown {
                self.holder.isHidden = true
            }
        })
    }

    private func tapped(_ key: String) {
        UISelectionFeedbackGenerator().selectionChanged()
        select(key, animated: true)
        // 화면 바꾸기는 사이트가 한다. key 는 위 네 경로 중 하나뿐이라 따옴표 걱정 없다
        page?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dgo:native-tab',{detail:'\(key)'}))", completionHandler: nil)
    }
}

/// 사이트 → 아이폰 탭 알약. set({tab, show}) — 값이 바뀔 때·3초마다 온다 (src/app/nativeTabs.ts useNativeTabs)
@objc(DgoTabBarPlugin)
public class DgoTabBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DgoTabBarPlugin"
    public let jsName = "DgoTabBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise)
    ]

    @objc func set(_ call: CAPPluginCall) {
        let tab = call.getString("tab") ?? ""
        let show = call.getBool("show") ?? false
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.nativeTabs.apply(tab: tab, show: show)
            call.resolve()
        }
    }
}
