# LinuxからiPhone 16にDevMoterを入れる

Mac・Windowsは不要です。GitHub Actionsで作ったIPAを、Linux版 **iloader** で署名してiPhoneに入れます。IPAをそのままタップしてもインストールできません。

## 1. IPAをLinuxにダウンロードする

1. GitHubの [iOS IPA for AltStore](https://github.com/syr4wpywkk-collab/DevMoter-FAST/actions/workflows/ios-altstore.yml) を開きます。
2. 緑のチェックが付いた実行を開きます。実行に使ったブランチとコミットを確認してください。
3. 下の **Artifacts → DevMoter-AltStore** をダウンロードします。GitHubへのログインが必要です。
4. ZIPを展開すると `DevMoter-AltStore.ipa` が出てきます。

## 2. Linuxにiloaderを入れる

[iloaderの公式リリース](https://github.com/nab138/iloader/releases/latest) を開き、自分のLinuxに合うものを選びます。

| Linux | ダウンロードする形式 |
| --- | --- |
| Ubuntu / Debian | DEB |
| Fedora / openSUSE | RPM |
| その他 | AppImage |

端末で `uname -m` を実行するとCPUの種類が分かります。`x86_64` はamd64版、`aarch64` はARM版です。`usbmuxd` も必要です。Ubuntu / Debianの場合は次のコマンドで入れます。

```bash
sudo apt update
sudo apt install usbmuxd
```

ダウンロードしたDEBをソフトウェアのインストール画面で開いてインストールし、iloaderを起動します。AppImageの場合はファイルのプロパティで実行権限を付けて起動します。

Chromebookの場合は、設定からiPhoneのUSB接続をLinux環境に渡す操作も必要です。[SideStoreの準備手順](https://docs.sidestore.io/docs/installation/prerequisites) のChromebook欄を参照してください。

## 3. iPhoneに入れる

1. iPhone 16をUSBケーブルでLinuxにつなぎ、ロックを解除します。
2. iPhoneに「このコンピュータを信頼しますか？」と出たら「信頼」を選びます。
3. iloaderで自分のApple Accountにサインインし、接続したiPhoneを選びます。AppleのパスワードはGitHubやチャットには送らず、手元のiloaderで入力します。
4. **Import IPA** から `DevMoter-AltStore.ipa` を選び、署名・インストールの完了を待ちます。
5. iPhoneの **設定 → 一般 → VPNとデバイス管理** で、必要に応じて自分の開発者アプリを信頼します。
6. **設定 → プライバシーとセキュリティ → デベロッパモード** を有効にし、案内に従って再起動します。

iloaderの画面やエラーはバージョンによって変わります。エラーが出た場合は、パスワードやコードを除いたエラーメッセージを確認してください。

## 4. DevMoterに接続する

DevMoterを開いてプロファイル名と **既に起動しているDevMoterサーバーのHTTPS URL** を入力します。サーバーのURLはGitHubのURLとは別です。Tailscale内のサーバーなら、iPhone側でもTailscaleに接続します。

接続後の **設定 → アカウント** でログイン中のアカウントを確認できます。プロファイルごとにログイン状態を保存しますが、サーバーは単一所有者向けで、複数ユーザーのデータ・権限分離は追加していません。

無料Apple Accountで署名したアプリは通常7日で期限が切れます。期限までにLinuxにつなぎ、iloaderで同じIPAを再署名・インストールしてください。アプリを削除するとローカルのプロファイルやログイン情報を失うため、更新のために先に削除する必要はありません。無料アカウントにはインストール数などの制限もあります。

PCなしで更新する方法が必要な場合は、[SideStoreの公式インストール手順](https://docs.sidestore.io/docs/installation/install) を使えます。iloaderの **Install SideStore (Stable)** から設定し、同じIPAをSideStoreに取り込みます。

このリポジトリのiOSビルド成功と、手元のiPhoneでの動作確認は別です。初回は起動、HTTPS接続、ログイン、プロファイル切替を確認してください。
