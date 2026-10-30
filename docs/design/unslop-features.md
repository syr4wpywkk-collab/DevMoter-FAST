# AIっぽさ(AI slop)の症状と直し方 — 抽出まとめ

出典は X 投稿と、投稿でリンク・紹介されていたスキルの README / SKILL.md。動画・画像だけの投稿(heydamir, GlebkaShipov, sudarsh1997, edo_lunardi など)は本文しか読めていないため、中身は grok による動画要約(https://x.com/grok/status/2115093153891889601)経由。

## 1. 色
1. 紫/ネオンパープル・紫→青を既定にする → ダークニュートラル等、製品固有の配色に。 (https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164, https://x.com/DegenOfWallSt/status/2106849952119005623, https://x.com/jay_k/status/2109654719610466367, https://x.com/aipruner/status/2115777754339930620, https://x.com/a4DamwL0058BaSi/status/2112015894092054999, Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623), i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
2. クリーム背景(#F4F1EA付近)+セリフ見出し+テラコッタ(#D97757付近)＝Anthropic風が新たな定番スロップ → 避ける。 (https://x.com/moelagouz2026/status/2115289726471098722, Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
3. 黒背景+単色の蛍光グリーン/朱アクセント、#0B0B0B/#111 の「ほぼ黒」も既定値の兆候。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
4. 色付き背景の上にグレー文字 → 禁止(コントラスト不足)。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
5. 配色に一貫性がない → パレットを 4〜6 個の名前付き hex に固定。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842), Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
6. 色は装飾ではなくデータに使う(アプリ画面)。 (taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))

## 2. グラデーション・グロー・影
7. 浮遊グラデ、光るブロブ、グロー、ネオン効果 → 削除。 (https://x.com/jay_k/status/2109654719610466367, https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
8. 重いグラスモーフィズム → やめてフラットに。 (https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
9. 不自然なドロップシャドウ、どのカードにも同じ rgba(0,0,0,.1) の影 → 削除/階層に応じて。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842), Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
10. 装飾目的のグラデーション多用 → 削除。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842), Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))

## 3. タイポグラフィ
11. 全部 Inter/汎用フォント → 意図して選んだ書体、1〜2 ファミリー(2つなら明確に違うもの)。 (https://x.com/DegenOfWallSt/status/2106849952119005623, https://x.com/grok/status/2115407315222315164, Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623), Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
12. 見出しの一語だけ斜体/太字/色違い → 禁止。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介), Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623) の Without 例)
13. ラベルの全部大文字・字間を広げた ALL CAPS アイブロウ → 禁止。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
14. コンテンツ上の不要なラベル → 削る。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
15. 小さなデータラベルに等幅フォント、リンク/ボタンに「→」付加、「A · B · C」の中黒区切り、「WORD — 断片」ラベル → 既定値の兆候。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
16. 明確なタイプスケール・ウェイト・字間を決める。1行 80 字未満、セリフ本文は行間を少し広く。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
17. 見出しにメリハリ(強弱)をつける / プロらしい書体で明確な階層。 (https://x.com/revolvtech/status/2112098930825773098, https://x.com/grok/status/2115407315222315164, https://x.com/probiex007/status/2115031502463594626)

## 4. 余白・グリッド・トークン
18. 余白がバラバラ → 8/16/24px スケールの厳密なグリッド。 (https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
19. 余白に強弱をつける(均一にしない)。 (https://x.com/revolvtech/status/2112098930825773098)
20. カード間の余白が広すぎ、幅に余裕を持たせすぎ → 締める。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
21. 窮屈なパディング → 検出対象。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
22. 左右マージンを等しく、セクションを片側に寄せない、意味のない空白を作らない。 (taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))
23. コード前に色・書体・レイアウト・原則のコンパクトなトークンを作る。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介), Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623) DESIGN.md, https://x.com/haluxel/status/2114566689530765553 日本語DESIGN.md)

## 5. 角丸
24. 丸いピル型カード → やめる。 (https://x.com/jay_k/status/2109654719610466367)
25. 階層に関係なく全部同じ border-radius → 階層で使い分け。逆に「角丸0+極細罫線の新聞風」も既定値。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
26. ピル型ボタンも定番の兆候。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))

## 6. カード・入れ子
27. カードの中にカード → 禁止。 (https://x.com/DegenOfWallSt/status/2106849952119005623, Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
28. 全部を同じ角丸カードに刻む「SaaSカードキット」 → 内容に応じた構造に。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
29. 4つの数字を同じ箱4つに並べる → 数字ごとに意味が伝わる表現(率ならゲージ、予算消化ならリング)。 (https://x.com/danylo_pravda/status/2112921863072678316)
30. アプリ画面はパネルを静かに。 (taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))

## 7. アイコン・絵文字
31. 絵文字をアイコン代わり+色付き丸/四角の背景 → 禁止。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842), https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
32. 見出しごとに角丸正方形のアイコンタイル → 禁止。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
33. ロゴ・アイコンはモノクロ/ミニマル・フラットに。 (https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
34. 不要なアイコン多用 → 減らす。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
35. 文字だけのアバターより実写真のほうがAIっぽさが減る。実素材を使う。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842), taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))

## 8. レイアウト・階層
36. 階層を締め、視覚ノイズを減らし、必要なデータだけ残す。 (https://x.com/grok/status/2115093153891889601, https://x.com/grok/status/2115407315222315164)
37. 均一なグリッドレイアウトは学習データ由来の定番 → 避ける。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
38. 閲覧用と編集用の情報が混在 → 分ける。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
39. ボタンでない所までボタンっぽく見える → やめる。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
40. 不自然なカテゴライズ・デザインの不統一 → 統一。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
41. ヒーローの「大きな数字+小ラベル+統計+グラデアクセント」は既定 → 主題に最も特徴的なものから始める。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
42. 01/02/03 の番号は内容が本当に順序のときだけ。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
43. 大胆さは一か所だけ。他は静かに、装飾を一つ外す。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
44. 構図を見直す / 1画面目に明確なタイトル。 (https://x.com/revolvtech/status/2112098930825773098, taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))
45. 「間違いは何もないが、何も決められていない」状態 → 方向性を先に決める。 (https://x.com/axbyalexai/status/2112748265850454063, https://x.com/a4DamwL0058BaSi/status/2112015894092054999, Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介), taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730), i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
46. 構造とデータは保ったまま見た目を直す。Linear/Vercel のように意図的に。 (https://x.com/grok/status/2115407315222315164)

## 9. データ表示・数値
47. 単純な棒グラフ → 洗練された複数系列のエリアチャート。 (https://x.com/grok/status/2115093153891889601)
48. 数値の桁をそろえる(aligned figures)。 (taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))
49. 派手な色付きバッジ → 落ち着いた正確なラベル。 (https://x.com/grok/status/2115093153891889601)
50. データ密度の高い表にはエディトリアル系スキルは不向き。モバイルで列を消さない。 (https://x.com/aipruner/status/2115777754339930620)

## 10. モーション
51. 各セクションのフェード+スライドアップ、全カードの hover → AIの既定。自発的モーションは一つの演出だけ。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
52. ユーザー操作への応答モーション(開閉・確定)は変化を示すなら可。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
53. prefers-reduced-motion を尊重。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
54. 質の高いLPはタイポとアニメーションで作る(MotionSites)。 (https://x.com/codex_lab_/status/2114738908424741148)

## 11. コピー
55. 絵文字・「!!」の煽り → 削除、落ち着いた正確なラベル。 (https://x.com/grok/status/2115093153891889601)
56. 不要な説明が多すぎ、全部テキストで説明 → 削る。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
57. コピーを具体的に、CTA の文言を改善。 (https://x.com/revolvtech/status/2112098930825773098)
58. CTA は何が起きるかを言う(「送信」でなく「変更を保存」)、同じ操作は同じ名前(Publish→Published)。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
59. ユーザー視点の平易な言葉(webhook設定でなく通知)、能動態、センテンスケース、売り込まない。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
60. エラーは謝らず、何が起きたか・どう直すかを言う。空画面は行動への誘い。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))
61. 「もっとおしゃれに」でなく「どこをどう直すか」を具体的に指示。短い指示だとAIっぽいまま。 (https://x.com/revolvtech/status/2112098930825773098, https://x.com/a4DamwL0058BaSi/status/2112015894092054999)

## 12. 日本語タイポ
62. 改行を自然に。 (https://x.com/revolvtech/status/2112098930825773098)
63. 英数字の違和感をなくす(和欧混植)。 (https://x.com/revolvtech/status/2112098930825773098)
64. 文字間隔を整える。 (https://x.com/revolvtech/status/2112098930825773098)
65. 日本語で使わない単位や順序、不要な英語表記 → 直す。 (i3DESIGN note (note.com/i3design_design/n/n3d8da4321ae7, https://x.com/kgsi/status/2108309631290482842))
66. 和文フォントと文字組みは別途指定する。 (https://x.com/haluxel/status/2114566689530765553)
67. モバイルで和文以外のグリフ欠け(フォントにない文字)に注意。 (https://x.com/aipruner/status/2115777754339930620)

## 13. アクセシビリティ・モバイル・検証
68. a11y違反を減らす(Hallmark で 45→3)。 (https://x.com/aipruner/status/2115777754339930620)
69. キーボードフォーカス可視、レスポンシブ、コントラスト確保。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介), Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623) audit)
70. モバイルは必ず手で確認。ナビは折りたたむ。 (https://x.com/aipruner/status/2115777754339930620, https://x.com/probiex007/status/2115031502463594626, taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730))
71. 実ブラウザで3幅のスクショを撮り、上位3問題を直す(最大3周)。 (taste-skill README (github.com/Leonxlnx/taste-skill, https://x.com/tungair87/status/2115449670604386730), Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介), https://x.com/haluxel/status/2114566689530765553 break-ui/webapp-testing)
72. 見出しレベルの飛ばし → 検出対象。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
73. エラー・i18n・オーバーフロー・エッジケースを固める(harden)。 (Impeccable README (github.com/pbakaus/impeccable, https://x.com/DegenOfWallSt/status/2106849952119005623))
74. CSS の詳細度が打ち消し合うクラスを作らない(特にセクション間の余白)。 (Anthropic frontend-design SKILL.md (github.com/anthropics/skills, https://x.com/wad0427/status/2111961525741342920 / https://x.com/a4DamwL0058BaSi/status/2112015894092054999 で紹介))

補足: 「最新モデルでもスロップ」(https://x.com/brice_garnier_/status/2113332663998419447)、「素のプロンプトでは紫グローにならなかった」(https://x.com/callmedraxxx/status/2115473459245703461)、「わざと作らせたbefore」(https://x.com/edo_lunardi/status/2115920320603533771) ＝ 紫は過去の定番で、今はクリーム/Anthropic風や無個性な整い方が問題、という流れ。
