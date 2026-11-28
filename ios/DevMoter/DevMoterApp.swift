import SwiftUI
import WebKit

struct ConnectionProfile: Identifiable, Codable {
    var id = UUID()
    var name: String
    var origin: URL

    static func validatedOrigin(_ value: String) -> URL? {
        guard var components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              (components.port == nil || (1...65535).contains(components.port!)),
              components.percentEncodedPath.isEmpty || components.percentEncodedPath == "/" else { return nil }
        components.scheme = "https"
        components.host = host.lowercased()
        if components.port == 443 { components.port = nil }
        components.path = "/"
        return components.url
    }

    func matchesOrigin(_ url: URL?) -> Bool {
        guard let url, let a = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let b = URLComponents(url: origin, resolvingAgainstBaseURL: false) else { return false }
        return a.scheme?.lowercased() == "https" && a.user == nil && a.password == nil &&
            a.host?.lowercased() == b.host?.lowercased() && (a.port ?? 443) == (b.port ?? 443)
    }
}

@main
struct DevMoterApp: App {
    var body: some Scene { WindowGroup { ProfilesView() } }
}

struct ProfilesView: View {
    @AppStorage("connectionProfiles") private var savedProfiles = Data()
    @State private var profiles: [ConnectionProfile] = []
    @State private var name = ""
    @State private var address = ""
    @State private var error = ""

    var body: some View {
        NavigationStack {
            List {
                Section("接続プロファイル") {
                    ForEach(profiles) { profile in
                        NavigationLink {
                            ServerView(profile: profile)
                        } label: {
                            VStack(alignment: .leading) {
                                Text(profile.name)
                                Text(profile.origin.absoluteString).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .onDelete { offsets in
                        let removed = offsets.map { profiles[$0].id }
                        profiles.remove(atOffsets: offsets)
                        persist()
                        for id in removed {
                            WKWebsiteDataStore.remove(forIdentifier: id) { removalError in
                                if removalError != nil {
                                    DispatchQueue.main.async { error = "プロファイルのWebデータを消去できませんでした。" }
                                }
                            }
                        }
                    }
                }
                Section("接続先を追加") {
                    TextField("プロファイル名", text: $name)
                    TextField("https://サーバー名", text: $address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    Button("追加") { addProfile() }
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                }
                Section {
                    Text("プロファイルごとにログイン状態とWeb設定を保存します。ログイン中のアカウントは接続後の設定 → アカウントで確認できます。サーバー側のデータと権限はサーバーの設定に従います。")
                        .font(.footnote)
                }
            }
            .navigationTitle("DevMoter")
            .onAppear {
                if let decoded = try? JSONDecoder().decode([ConnectionProfile].self, from: savedProfiles) {
                    profiles = decoded.compactMap { profile in
                        guard let origin = ConnectionProfile.validatedOrigin(profile.origin.absoluteString) else { return nil }
                        return ConnectionProfile(id: profile.id, name: profile.name, origin: origin)
                    }
                } else if !savedProfiles.isEmpty {
                    error = "保存された接続設定を読み込めませんでした。"
                }
            }
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(profiles) { savedProfiles = data }
    }

    private func addProfile() {
        guard let origin = ConnectionProfile.validatedOrigin(address),
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            error = "名前とHTTPSの接続先を入力してください。パスや認証情報は含めないでください。"
            return
        }
        profiles.append(ConnectionProfile(name: name.trimmingCharacters(in: .whitespacesAndNewlines), origin: origin))
        persist()
        name = ""
        address = ""
        error = ""
    }
}

struct ServerView: View {
    let profile: ConnectionProfile
    @State private var error = ""
    @State private var reloadID = UUID()
    @State private var homeID = UUID()
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 0) {
            if !error.isEmpty {
                Text(error).font(.footnote).foregroundStyle(.red).padding()
            }
            if isLoading { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 4) }
            ServerWebView(profile: profile, error: $error, isLoading: $isLoading, reloadID: reloadID, homeID: homeID)
        }
        .navigationTitle(profile.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            Button("ホーム", systemImage: "house") { homeID = UUID() }
            Button("再読み込み", systemImage: "arrow.clockwise") {
                error = ""
                reloadID = UUID()
            }
        }
    }
}

struct ServerWebView: UIViewRepresentable {
    let profile: ConnectionProfile
    @Binding var error: String
    @Binding var isLoading: Bool
    var reloadID: UUID
    var homeID: UUID

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: profile.id)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isInspectable = false
        view.load(URLRequest(url: profile.origin))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let coordinator = context.coordinator
        let goHome = coordinator.parent.homeID != homeID
        let reload = coordinator.parent.reloadID != reloadID
        coordinator.parent = self
        if goHome { view.load(URLRequest(url: profile.origin)) }
        else if reload {
            if profile.matchesOrigin(view.url) { view.reload() }
            else { view.load(URLRequest(url: profile.origin)) }
        }
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: ServerWebView
        init(_ parent: ServerWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            // OAuth may navigate to a provider and return to the server in this store.
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let isHTTPS = components?.scheme?.lowercased() == "https" && components?.host != nil &&
                components?.user == nil && components?.password == nil
            guard isHTTPS || (url.absoluteString == "about:blank" && navigationAction.targetFrame?.isMainFrame == false) else {
                parent.error = "HTTPS以外のページは開けません。"
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
               let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
               components.scheme?.lowercased() == "https", let host = components.host,
               components.user == nil, components.password == nil {
                if parent.profile.matchesOrigin(url) {
                    webView.load(navigationAction.request)
                } else {
                    let alert = UIAlertController(title: "外部ブラウザで開く", message: host, preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel))
                    alert.addAction(UIAlertAction(title: "開く", style: .default) { _ in UIApplication.shared.open(url) })
                    _ = present(alert, from: webView)
                }
            }
            return nil
        }

        private func present(_ alert: UIAlertController, from webView: WKWebView) -> Bool {
            guard let root = webView.window?.rootViewController else { return false }
            var presenter = root
            while let next = presenter.presentedViewController { presenter = next }
            guard presenter.viewIfLoaded?.window != nil, !(presenter is UIAlertController),
                  !presenter.isBeingDismissed, !presenter.isBeingPresented else { return false }
            presenter.present(alert, animated: true)
            return true
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard parent.profile.matchesOrigin(frame.request.url), frame.isMainFrame else { completionHandler(); return }
            let alert = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            if !present(alert, from: webView) { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard parent.profile.matchesOrigin(frame.request.url), frame.isMainFrame else { completionHandler(false); return }
            let alert = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            if !present(alert, from: webView) { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                     completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            let space = challenge.protectionSpace
            if space.authenticationMethod == NSURLAuthenticationMethodServerTrust {
                completionHandler(.performDefaultHandling, nil)
                return
            }
            guard space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic,
                  !space.isProxy(), space.protocol?.lowercased() == "https",
                  space.host.lowercased() == parent.profile.origin.host?.lowercased(),
                  space.port == (parent.profile.origin.port ?? 443),
                  challenge.previousFailureCount < 3 else {
                completionHandler(.cancelAuthenticationChallenge, nil)
                return
            }
            let alert = UIAlertController(title: "サーバー認証", message: parent.profile.origin.absoluteString, preferredStyle: .alert)
            alert.addTextField { field in field.placeholder = "ユーザー名"; field.autocapitalizationType = .none; field.autocorrectionType = .no }
            alert.addTextField { field in field.placeholder = "パスワード"; field.isSecureTextEntry = true }
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(.cancelAuthenticationChallenge, nil) })
            alert.addAction(UIAlertAction(title: "ログイン", style: .default) { [weak alert] _ in
                guard let fields = alert?.textFields, fields.count == 2 else { completionHandler(.cancelAuthenticationChallenge, nil); return }
                let credential = URLCredential(user: fields[0].text ?? "", password: fields[1].text ?? "", persistence: .forSession)
                fields[1].text = nil
                completionHandler(.useCredential, credential)
            })
            if !present(alert, from: webView) { completionHandler(.cancelAuthenticationChallenge, nil) }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.error = ""
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.isLoading = false
            parent.error = "Web画面が停止しました。再読み込みしてください。"
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            if (error as NSError).code != NSURLErrorCancelled {
                parent.error = "接続できませんでした: \(error.localizedDescription)"
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
            if (error as NSError).code != NSURLErrorCancelled {
                parent.error = "読み込めませんでした: \(error.localizedDescription)"
            }
        }
    }
}
