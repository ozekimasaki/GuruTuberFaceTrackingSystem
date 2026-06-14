// MediaPipe FaceLandmarker を使って顔の向き・まばたきを検出するフック
// @mediapipe/tasks-vision (Apache License 2.0, Google LLC)

import { useEffect, useRef, useCallback } from 'react';

// MediaPipe FaceMesh ランドマークインデックス
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;
const CHIN = 152;

// まばたき検出用: 上下瞼のランドマーク
const LEFT_EYE_V = { top: 159, bottom: 145 };
const RIGHT_EYE_V = { top: 386, bottom: 374 };

// しきい値
const BLINK_EAR_THRESHOLD = 0.22;
const BLINK_DEBOUNCE_MS = 120;
const YAW_SENSITIVITY_DEG = 30;   // この角度で端に到達
const PITCH_SENSITIVITY_DEG = 25;

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// 2点間のユークリッド距離（正規化座標）
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Eye Aspect Ratio（EAR）: まばたき検出の定番手法
// EAR = (|V2-V6| + |V3-V5|) / (2 * |V1-V4|)
// 目が開いていると約0.3前後、閉じると0に近づく
function calcEAR(landmarks, outer, inner_h, top, bottom) {
  const v = dist(landmarks[top], landmarks[bottom]);
  const h = dist(landmarks[outer], landmarks[inner_h]);
  return h > 0 ? v / h : 0.3;
}

/**
 * useFaceTracking - MediaPipe FaceLandmarker フック
 *
 * @param {HTMLVideoElement} videoEl   - Webカメラのvideo要素
 * @param {Object}           opts      - 設定
 * @param {number}           opts.smoothing  - 追従の滑らかさ (0.04〜0.5)
 * @param {number}           opts.yawSens    - ヨー感度 (5〜60度)
 * @param {number}           opts.pitchSens  - ピッチ感度 (5〜60度)
 * @param {number}           opts.blinkThreshold - EARしきい値 (0.1〜0.4)
 * @param {Function}         onResult  - コールバック { yaw, pitch, blink, ready, ear, error }
 */
export default function useFaceTracking(videoEl, opts, onResult) {
  const rafRef = useRef(null);
  const stateRef = useRef({
    yaw: 0, pitch: 0,
    blink: false, lastBlinkTime: 0,
    ear: 0.3, ready: false, error: null,
    landmarker: null, videoEl: null,
    calibrated: false, baseYaw: 0, basePitch: 0, calibFrames: 0,
  });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const callbackRef = useRef(onResult);
  callbackRef.current = onResult;

  useEffect(() => {
    if (!videoEl) return;

    let cancelled = false;
    let landmarker = null;

    async function init() {
      try {
        console.log('[FaceTrack] MediaPipe loading...');
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, FaceLandmarker } = vision;

        // MediaPipe WASMランタイムをCDNからロード
        const fileset = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );

        landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        stateRef.current.landmarker = landmarker;
        stateRef.current.ready = true;
        stateRef.current.videoEl = videoEl;
        console.log('[FaceTrack] MediaPipe ready ✓');
      } catch (err) {
        stateRef.current.error = 'MediaPipe初期化に失敗: ' + err.message;
        if (callbackRef.current) {
          callbackRef.current({ ...stateRef.current });
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      if (landmarker) {
        try { landmarker.close(); } catch (e) {}
      }
    };
  }, [videoEl]);

  // 検出ループ
  useEffect(() => {
    let frameCount = 0;
    let lastLogTime = 0;
    if (!videoEl) return;

    let lastTimestamp = -1;

    function detect() {
      rafRef.current = requestAnimationFrame(detect);

      const st = stateRef.current;
      const lm = st.landmarker;
      const ve = st.videoEl || videoEl;

      if (!lm || !st.ready) return;
      if (ve.readyState < 2 || ve.videoWidth === 0) return;

      const now = performance.now();
      // 同じフレームを再処理しない
      if (ve.currentTime === lastTimestamp) return;
      lastTimestamp = ve.currentTime;

      try {
        const result = lm.detectForVideo(ve, now);
        if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
          if (frameCount < 5) console.log('[FaceTrack] No face detected in frame');
          return;
        }

        const lm0 = result.faceLandmarks[0];
        const o = optsRef.current;
        const yawSens = o?.yawSens ?? YAW_SENSITIVITY_DEG;
        const pitchSens = o?.pitchSens ?? PITCH_SENSITIVITY_DEG;
        const blinkThr = o?.blinkThreshold ?? BLINK_EAR_THRESHOLD;
        const smoothing = o?.smoothing ?? 0.3;

        // ── ヘッドポーズ計算 ──
        const noseTip = lm0[NOSE_TIP];
        const leftEye = lm0[LEFT_EYE_OUTER];
        const rightEye = lm0[RIGHT_EYE_OUTER];
        const chin = lm0[CHIN];

        // 顔中心（目の中間）
        const eyeMidX = (leftEye.x + rightEye.x) / 2;
        const eyeMidY = (leftEye.y + rightEye.y) / 2;

        // ヨー（左右回転）: 鼻が顔中心からどれだけ離れているか
        // Webカメラはミラーされるので反転
        const faceHalfWidth = Math.abs(rightEye.x - leftEye.x) / 2;
        const rawYaw = faceHalfWidth > 0.01
          ? (noseTip.x - eyeMidX) / faceHalfWidth
          : 0;
        // ピッチ用変数（キャリブレーションより前に定義）
        const eyeToChin = Math.abs(chin.y - eyeMidY);
        const noseToEye = eyeMidY - noseTip.y; // 上向き=正

        // ── キャリブレーション ──
        // 最初の30フレームで基準位置を学習
        if (!st.calibrated) {
          st.baseYaw += rawYaw;
          st.basePitch += (noseToEye / (eyeToChin || 0.01));
          st.calibFrames++;
          if (st.calibFrames >= 30) {
            st.baseYaw /= 30;
            st.basePitch /= 30;
            st.calibrated = true;
            console.log('[FaceTrack] Calibrated! baseYaw:', st.baseYaw.toFixed(4), 'basePitch:', st.basePitch.toFixed(4));
          }
          return; // キャリブレーション中は検出をスキップ
        }
        // 基準位置からの差分を計算
        const relYaw = -(rawYaw - st.baseYaw);  // ミラー補正: 反転
        const yawNorm = clamp(relYaw, -1.0, 1.0);

        // ピッチ（上下）
        const rawPitchRatio = eyeToChin > 0.01 ? noseToEye / eyeToChin : st.basePitch;
        const relPitch = (rawPitchRatio - st.basePitch) * 6; // 差分 × 感度
        const pitchNorm = clamp(relPitch, -1.0, 1.0);

        // 平滑化
        st.yaw = lerp(st.yaw, yawNorm, smoothing);
        st.pitch = lerp(st.pitch, pitchNorm, smoothing);

        // ── まばたき検出（EAR） ──
        const earLeft = calcEAR(lm0, LEFT_EYE_OUTER, 133,
          LEFT_EYE_V.top, LEFT_EYE_V.bottom);
        const earRight = calcEAR(lm0, RIGHT_EYE_OUTER, 362,
          RIGHT_EYE_V.top, RIGHT_EYE_V.bottom);
        const rawEAR = (earLeft + earRight) / 2;

        // EARの平滑化（速い反応）
        st.ear = lerp(st.ear, rawEAR, 0.5);

        const isBlinking = st.ear < blinkThr;
        if (isBlinking && !st.blink && (now - st.lastBlinkTime) > BLINK_DEBOUNCE_MS) {
          st.blink = true;
          st.lastBlinkTime = now;
        } else if (!isBlinking && st.ear > blinkThr + 0.05) {
          st.blink = false;
        }

      } catch (err) {
        // フレームごとのエラーは無視（次フレームで復帰することが多い）
        console.warn('FaceLandmarker detect error:', err.message);
      }

      // デバッグログ（1秒に1回）
      frameCount++;
      if (now - lastLogTime > 1000) {
        console.log('[FaceTrack] fps:', frameCount, 'yaw:', st.yaw.toFixed(3), 'pitch:', st.pitch.toFixed(3), 'ear:', st.ear.toFixed(3), 'blink:', st.blink);
        frameCount = 0;
        lastLogTime = now;
      }

      // コールバックで通知
      if (callbackRef.current) {
        callbackRef.current({
          yaw: st.yaw,
          pitch: st.pitch,
          blink: st.blink,
          ear: st.ear,
          ready: st.ready,
          error: st.error,
        });
      }
    }

    rafRef.current = requestAnimationFrame(detect);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoEl]);

  return stateRef;
}
