# GuruTuberFaceTrackingSystem

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face%20Landmarker-orange)](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)

Webカメラの顔検出（MediaPipe FaceLandmarker）でキャラクターが25方向に振り向き、音声に合わせて口パク・まばたきするブラウザアバターです。

> **Upstream (元プロジェクト)**: [tomari-guruguru](https://github.com/rotejin/tomari-guruguru) — マウス追従ベースのオリジナル版

---

## 特徴

- **顔追従**: MediaPipe FaceLandmarker で468点の顔ランドマークを検出し、yaw（左右）/ pitch（上下）を計算
- **自動キャリブレーション**: 起動時に正面顔を30フレーム学習し、個人差に合わせた基準位置を自動設定
- **口パク**: マイク入力または音声ファイルの音量に応じて口が3段階（とじ / 中間 / 開け）で切り替わる
- **まばたき検出**: Eye Aspect Ratio（EAR）で自然なまばたきをリアルタイム検出し、目閉じシートに切り替え
- **25方向グリッド**: 5×5グリッドのスライス画像で滑らかに顔を回転
- **OBS対応**: 背景色を変更可能（クロマキー合成用）

---

## セットアップ

```bash
npm install
```

## ローカル起動

Windowsなら `start.bat` をダブルクリック、または:

```bash
npm run dev
```

ブラウザで自動で開きます。手動アクセス:

```text
http://127.0.0.1:5173/
```

### 注意

- カメラ・マイクは `localhost` または HTTPS でのみ利用できます
- Webカメラへのアクセス許可が必要です
- Google Fonts（Zen Maru Gothic）はCDNから読み込みます

## ビルド

```bash
npm run build
npm run preview   # ビルド結果をローカル確認
```

---

## 使い方

1. ブラウザで開き、**カメラを許可**する
2. 正面を向いて待つ（自動キャリブレーション: 約1秒）
3. **マイク開始** を押す、または音声ファイルを読み込む
4. 顔を動かすとキャラクターが追従し、声に合わせて口パクします
5. 右下の **Tweaks** ボタンから感度や表示サイズを調整可能

---

## ディレクトリ構成

```
.
├── index.html                # エントリポイント
├── vite.config.js            # Vite 8 ビルド設定
├── package.json
├── start.bat                 # Windows用起動バッチ
├── src/
│   ├── facetrack-app.jsx     # メインアプリ（顔追従 + 口パク + まばたき）
│   ├── use-face-tracking.js  # MediaPipe FaceLandmarker フック
│   ├── tweaks-panel.jsx      # 調整パネルUI
│   └── character-config.js   # キャラ画像パスの設定
├── public/
│   └── slices3/              # スライス済みキャラ画像（5×5 × 6シート）
├── LICENSE                   # MIT License（プログラム部分）
├── ASSET_LICENSE.md          # キャラクターアセットのライセンス
└── README.md
```

---

## 技術的な仕組み

### 顔追従

MediaPipe FaceLandmarker が468点の顔ランドマークを毎フレーム検出します。
主要ランドマークから yaw（左右回転）と pitch（上下回転）を算出し、25方向グリッドにマッピングします。

| 方向 | ランドマーク | 計算方法 |
|---|---|---|
| yaw（左右） | 鼻(1), 左目(33), 右目(263) | 鼻の横方向オフセット ÷ 顔幅 |
| pitch（上下） | 目(33,263), 鼻(1), 顎(152) | 鼻〜目の距離 ÷ 目〜顎の距離 |

### 自動キャリブレーション

起動直後の30フレームで正面顔の基準値を学習し、以降は差分ベースで追従します。
これにより個人差（顔の形・カメラ距離）に影響されずに動作します。

### まばたき検出（EAR）

Eye Aspect Ratio で目の開閉度を計算:
`EAR = 縦距離 / 横距離`
しきい値（デフォルト 0.22）以下でまばたきと判定し、目閉じシート（D/E/F）に切り替えます。

### フレーム画像

| フォルダ | 目 | 口 |
|---|---|---|
| `A` | 開け | とじ |
| `B` | 開け | 中間 |
| `C` | 開け | 開け |
| `D` | 閉じ | とじ |
| `E` | 閉じ | 中間 |
| `F` | 閉じ | 開け |

画像パス例: `slices3/A/r2c2.webp`（目開け・口とじ・正面）

---

## 自分のキャラで使う

1. 5×5グリッドのスライス画像（A〜Fシート × 25フレーム = 150枚）を用意
2. `public/slices3/{A..F}/r{0-4}c{0-4}.webp` に配置
3. `src/character-config.js` の `basePath` を必要に応じて編集

---

## ライセンス

### プログラム部分

[MIT License](./LICENSE) — 派生元: [tomari-guruguru](https://github.com/rotejin/tomari-guruguru)（MIT, Copyright (c) 2026 rotejin）

### キャラクターアセット

桜草メイ（Sakuraso Mei）のキャラクター画像は MIT License の対象外です。
利用ガイドライン: **https://maymai.dev/mayproject/guidelines/**

詳細は [ASSET_LICENSE.md](./ASSET_LICENSE.md) を参照してください。

---

## 技術スタック

- **Vite 8** — ビルド・開発サーバー
- **React 18** — UI フレームワーク
- **@mediapipe/tasks-vision** — FaceLandmarker（Apache 2.0, Google LLC）
