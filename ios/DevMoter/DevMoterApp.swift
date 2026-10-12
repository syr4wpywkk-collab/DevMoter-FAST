import SwiftUI
import WebKit

struct ConnectionProfile: Identifiable, Codable {
    var id = UUID()
    var name: String
    var origin: URL

    static func validatedOrigin(_ value: String) -> URL? {
        guard let components = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.path.isEmpty || components.path == "/" else { return nil }
        return components.url
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
                            WKWebsiteDataStore.remove(forIdentifier: id) { _ in }
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
                profiles = (try? JSONDecoder().decode([ConnectionProfile].self, from: savedProfiles)) ?? []
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

    var body: some View {
        VStack(spacing: 0) {
            if !error.isEmpty {
                Text(error).font(.footnote).foregroundStyle(.red).padding()
            }
            ServerWebView(profile: profile, error: $error).id(reloadID)
        }
        .navigationTitle(profile.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
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

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: profile.id)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: profile.origin))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: ServerWebView
        init(_ parent: ServerWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            // OAuth may navigate to a provider and return to the server in this store.
            guard url.scheme?.lowercased() == "https" || url.absoluteString == "about:blank" else {
                parent.error = "HTTPS以外のページは開けません。"
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
               url.scheme?.lowercased() == "https" {
                // Verification links open in Safari; the server's device flow polls in this web view.
                UIApplication.shared.open(url)
            }
            return nil
        }

        private func present(_ alert: UIAlertController, from webView: WKWebView) -> Bool {
            guard let root = webView.window?.rootViewController else { return false }
            var presenter = root
            while let next = presenter.presentedViewController { presenter = next }
            presenter.present(alert, animated: true)
            return true
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let alert = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            if !present(alert, from: webView) { completionHandler() }
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let alert = UIAlertController(title: frame.request.url?.host, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            if !present(alert, from: webView) { completionHandler(false) }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled {
                parent.error = "接続できませんでした: \(error.localizedDescription)"
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled {
                parent.error = "読み込めませんでした: \(error.localizedDescription)"
            }
        }
    }
}
