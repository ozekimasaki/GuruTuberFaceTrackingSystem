# AGENTS.md — tomari-facetrack

## プロジェクト概要

MediaPipe FaceLandmarker（`@mediapipe/tasks-vision`）を使った顔追従 + リップシンク Web アプリ。  
Web カメラで顔の向き（yaw/pitch）・まばたきを検出し、5×5 グリッド状に分割されたキャラクター画像をリアルタイムで切り替えて表示する。マイクまたは音声ファイルの音量に応じて口パクさせる。

> 派生元: [tomari-guruguru](https://github.com/rotejin/tomari-guruguru)（マウス追従ベースのオリジナル版）

## 技術スタック

- **React 18** (JSX)
- **Vite 8** (ビルドツール / dev サーバー)
- **@mediapipe/tasks-vision** (FaceLandmarker — CDN 経由で WASM ロード)
- **Web Audio API** (マイク・音声ファイルの音量解析 → 口パク)
- **フォント**: Zen Maru Gothic (Google Fonts)

## ディレクトリ構成

```
src/
  facetrack-app.jsx     # メインコンポーネント + エントリポイント + レンダリング
  use-face-tracking.js  # MediaPipe FaceLandmarker フック（顔追従・まばたき検出）
  character-config.js   # キャラクター画像設定（ベースパス・グリッド・シート定義）
  tweaks-panel.jsx      # 汎用 Tweaks パネル UI（スライダー・トグル・カラーピッカー等）

public/
  slices3/              # キャラクター画像（A〜F シート × 5×5 グリッド = 150 枚）
    A/r0c0.webp ...     #   A = 目開け × 口とじ
    B/...               #   B = 目開け × 口はんびらき
    C/...               #   C = 目開け × 口ぜんかい
    D/...               #   D = 目閉じ × 口とじ
    E/...               #   E = 目閉じ × 口はんびらき
    F/...               #   F = 目閉じ × 口ぜんかい

index.html              # エントリ HTML（#root に React マウント）
vite.config.js          # Vite 設定（React プラグイン、単一エントリ）
start.bat               # Windows 起動バッチ
```

## アーキテクチャ

### データフロー

```
Webカメラ → video要素 → MediaPipe FaceLandmarker → yaw/pitch/blink/ear
                                                    ↓
                                            グリッドセル (row, col) 算出
                                                    ↓
                                            シート選択 (目開閉 × 口段階)
                                                    ↓
                                            キャラクター画像 opacity 切替

マイク / 音声ファイル → AudioContext Analyser → RMS音量レベル
                                                    ↓
                                            エンベロープ追従 → 口段階 (0/1/2)
```

### シート選択ロジック

- シート A〜F = 目開け(A/B/C) × 目閉じ(D/E/F)、各シート内で口が とじ/はんびらき/ぜんかい
- グリッドは 5×5: row=上下(pitch), col=左右(yaw)
- 全 150 フレームを事前に DOM 生成し、opacity で表示/非表示を切替

### tweaks-panel.jsx の設計

- `window` グローバルに `useTweaks`, `TweaksPanel`, `TweakSlider` 等を export
- omelette starter scaffold 由来の再利用可能な UI コンポーネント群
- ホストとのポストメッセージ通信で Edit Mode 連携に対応
- スタイルは CSS-in-JS（`__TWEAKS_STYLE` 定数にバンドル）

## 開発環境

- **OS**: Windows での利用を想定（`start.bat` を同梱）。macOS / Linux でも `npm` コマンドで動作する
- **Node.js**: **20.19+ または 22.12+**（Vite 8 の要件。これ未満では build/dev が `Vite requires Node.js version 20.19+ or 22.12+` で失敗する）。`package.json` に `engines` 指定はなし
- **パッケージマネージャ**: `npm`（`package-lock.json` を同梱）
- **ブラウザ要件**: WebRTC (getUserMedia) + WebGL2 (MediaPipe GPU delegate) 対応ブラウザ
- **ハードウェア**: Web カメラ必須。マイクは口パク（マイク入力）を使う場合に必要（音声ファイル読み込みのみなら任意）
- **起動方法**: `start.bat` を実行（初回のみ `npm install` → `npm run dev`）
  - ※ `node_modules` が存在しない場合は自動で依存インストールされる
- **ネットワーク**: 初回起動時に MediaPipe WASM + モデルファイルおよび Google Fonts を CDN からダウンロードするためインターネット接続が必要
- **実行コンテキスト**: カメラ・マイク API は `localhost` または HTTPS 経由でのみ利用可能

## 開発コマンド

```bash
npm install       # 依存インストール
npm run dev       # Vite dev サーバー起動（127.0.0.1、ブラウザ自動オープン）
npm run build     # プロダクションビルド（dist/ に出力）
npm run preview   # ビルド結果のプレビュー
```

- **テスト / lint / typecheck**: いずれも設定されていない（`package.json` の scripts は `dev` / `build` / `preview` のみ、ESLint・Prettier・TypeScript・テストランナーの設定ファイルは無し）。変更後は `npm run build` が通ることで最低限の検証とする。

## コーディング規約

- **言語**: JavaScript（JSX）、型定義なし
- **スタイル**: インライン `style` オブジェクト（CSS Modules や Tailwind は不使用）
- **コメント**: 日本語で記述
- **コンポーネント**: 関数コンポーネント + Hooks のみ（クラスコンポーネント不使用）
- **グローバル変数**: tweaks-panel.jsx は `window` にコンポーネントを登録する
- **ファイル名**: ケバブケース（`use-face-tracking.js`, `character-config.js`）

## キャラクター画像の差し替え

1. `public/slices3/` に新しい画像を配置（A〜F シート × 5×5 グリッド）
2. `src/character-config.js` の `basePath`, `ext`, `rows`, `cols`, `sheets` を更新

## UI 機能

### 背景色設定

- Tweaks パネル「見た目」セクションに 2 種類の背景色設定を用意
  - **プリセット**: `BG_OPTIONS`（4 色: `#FFF8EE`, `#FDEFEF`, `#EEF4FB`, `#2B2926`）から選択
  - **カスタム色**: ネイティブ `<input type="color">` による自由な色指定（`customBgColor` で管理、選択時に `bgColor` へ反映）
- 背景色に応じてテキスト色・パネル背景色・ボーダー色を自動切替（ダーク判定: `bgColor === '#2B2926'`）

### HUD 表示切替（H キーショートカット）

- `H` キー押下で HUD の表示/非表示をトグル（`showHud` state）
- 非表示になる要素: タイトル、下部コントロールパネル、エラー表示、音声プレイヤー、Tweaks ボタン（FAB）
- 非表示にならない要素: キャラクター画像、カメラプレビュー、デバッグ表示（OBS 配信等でキャラクターは残すため）
- `input`/`textarea`/`select`/`contentEditable` 要素内でのキー入力は無視される

## 重要な実装詳細

- `@mediapipe/tasks-vision` は `await import(...)` で動的 import し、WASM ランタイム（`cdn.jsdelivr.net`）とモデルファイル（`storage.googleapis.com`）を CDN から取得する
- 顔追従のキャリブレーションは最初の 30 フレームで基準位置（`baseYaw`/`basePitch`）を学習し、以降は差分ベースで追従する（キャリブレーション中は検出結果をスキップ）
- ヨーはミラー補正のため反転して扱う（Web カメラ映像がミラー表示のため）
- EAR (Eye Aspect Ratio) でまばたき検出（しきい値デフォルト 0.22、`BLINK_DEBOUNCE_MS` によるデバウンスあり）
- 口パクは RMS 音量レベルをエンベロープ追従させ、2 段階のしきい値（`thHalf`/`thFull`）で 3 段階（とじ/はんびらき/ぜんかい）に分類
- `requestAnimationFrame` ベースのメインループで音声レベル → 口段階を毎フレーム更新
- 全 150 フレームの `<img>` を事前生成し、`opacity` で表示/非表示を切り替える（画像の差し替え・再マウントは行わない）

## リポジトリのルール・ライセンス

- **`.qoder/rules/project-rules.md`**（always-on ルール）: 作業前に `AGENTS.md` を読む / コメントは日本語 / ファイル名はケバブケース / インライン `style` を使い CSS Modules・Tailwind は導入しない / 関数コンポーネント + Hooks のみ、を厳守すること
- **ライセンス分離**: プログラム部分は MIT（`LICENSE`）。キャラクター画像などのアセット（`public/slices3/` 等）は MIT 対象外（`ASSET_LICENSE.md`）。桜草メイのキャラクター画像を別用途へ流用・再配布・AI 学習等に使わないこと。差し替え用途では権利を持つ画像に置き換える
- 変更対象は原則 `src/`・`index.html`・設定ファイルなど。`public/slices3/` のアセットや `LICENSE` / `ASSET_LICENSE.md` を許可なく変更しない
