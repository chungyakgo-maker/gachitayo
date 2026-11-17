// 앱 로그인 (설계 docs/superpowers/specs/2026-11-17-app-login-design.md): 바깥 패키지 없이 iOS 기본 기능만 쓴다.
//   webAuth({url, scheme})  카카오 로그인 창(ASWebAuthenticationSession). 서버가 dgo://auth/kakao?… 로 보내면 그 주소를 돌려준다
//   appleSignIn({nonce})    애플 로그인 창. identityToken·authorizationCode·이름(처음 로그인 때만)을 돌려준다
// 사용자가 창을 닫으면 {cancelled: true}.
import Foundation
import Capacitor
import AuthenticationServices

@objc(DgoAuthPlugin)
public class DgoAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "DgoAuthPlugin"
    public let jsName = "DgoAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "webAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "appleSignIn", returnType: CAPPluginReturnPromise),
    ]

    private var webSession: ASWebAuthenticationSession?
    private var appleCall: CAPPluginCall?

    private func anchor() -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    // ── 카카오: iOS 로그인 창 ──

    @objc func webAuth(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), let scheme = call.getString("scheme"), !scheme.isEmpty else {
            call.reject("잘못된 주소")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.webSession = nil
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    call.resolve(["cancelled": true])
                    return
                }
                if let e = error {
                    call.reject(e.localizedDescription)
                    return
                }
                call.resolve(["url": callbackURL?.absoluteString ?? ""])
            }
            session.presentationContextProvider = self
            // 사파리에 이미 카카오 로그인이 되어 있으면 그대로 쓴다
            session.prefersEphemeralWebBrowserSession = false
            self.webSession = session
            if !session.start() {
                self.webSession = nil
                call.reject("로그인 창을 열지 못했어요")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return anchor()
    }

    // ── 애플 로그인 ──

    @objc func appleSignIn(_ call: CAPPluginCall) {
        let nonce = call.getString("nonce") ?? ""
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName]
            request.nonce = nonce
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.appleCall = call
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return anchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = appleCall else { return }
        appleCall = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            call.reject("애플 로그인 정보를 받지 못했어요")
            return
        }
        let code = cred.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        // 한국식 이름 순서 (성 + 이름), 처음 로그인 때만 온다
        let name = [cred.fullName?.familyName, cred.fullName?.givenName].compactMap { $0 }.joined()
        call.resolve(["identityToken": token, "authorizationCode": code, "name": name])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = appleCall else { return }
        appleCall = nil
        if let e = error as? ASAuthorizationError, e.code == .canceled {
            call.resolve(["cancelled": true])
            return
        }
        call.reject(error.localizedDescription)
    }
}
