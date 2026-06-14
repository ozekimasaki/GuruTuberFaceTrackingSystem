import React from 'react';
import ReactDOM from 'react-dom/client';
import charConfig from './character-config';
import useFaceTracking from './use-face-tracking';
import './tweaks-panel.jsx';  // windowにuseTweaks等を登録

const { useState, useEffect, useRef, useMemo, useCallback } = React;

const TALK_DEFAULTS = {
  charSize: 64,
  bgColor: '#FFF8EE',
  micGain: 1.6,
  thHalf: 0.07,
  thFull: 0.2,
  release: 0.12,
  smoothing: 0.28,
  yawSens: 28,
  pitchSens: 22,
  blinkThreshold: 0.22,
  showCamera: false,
  showDebug: false,
  customBgColor: '#FFF8EE',
};

const { rows: ROWS, cols: COLS } = charConfig;
// シート: 目開け×口[とじ/中間/開け] = A/B/C, 目閉じ×口[とじ/中間/開け] = D/E/F
const SHEETS = [
  charConfig.sheets.eyesOpen.close,   // A
  charConfig.sheets.eyesOpen.half,    // B
  charConfig.sheets.eyesOpen.open,    // C
  charConfig.sheets.eyesClosed.close, // D
  charConfig.sheets.eyesClosed.half,  // E
  charConfig.sheets.eyesClosed.open,  // F
];
const sheetFor = (eyesClosed, mouth) => SHEETS[(eyesClosed ? 3 : 0) + mouth];
const SRC = (sheet, r, c) => charConfig.src(sheet, r, c);
const BG_OPTIONS = ['#FFF8EE', '#FDEFEF', '#EEF4FB', '#2B2926'];

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// ── 音声エンジン（音量ベース口パク用） ──
function makeAudioEngine() {
  const st = {
    ctx: null, micAnalyser: null, micStream: null,
    fileAnalyser: null, fileSourceMade: false, buf: null
  };
  function ctx() {
    if (!st.ctx) st.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return st.ctx;
  }
  function levelOf(analyser) {
    if (!analyser) return 0;
    if (!st.buf || st.buf.length !== analyser.fftSize) st.buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(st.buf);
    let sum = 0;
    for (let i = 0; i < st.buf.length; i++) sum += st.buf[i] * st.buf[i];
    return Math.sqrt(sum / st.buf.length);
  }
  return {
    async startMic() {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const c = ctx();
      await c.resume();
      const src = c.createMediaStreamSource(stream);
      const an = c.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      st.micStream = stream;
      st.micAnalyser = an;
    },
    stopMic() {
      if (st.micStream) st.micStream.getTracks().forEach((t) => t.stop());
      st.micStream = null;
      st.micAnalyser = null;
    },
    attachAudioEl(el) {
      if (st.fileSourceMade) return;
      const c = ctx();
      const src = c.createMediaElementSource(el);
      const an = c.createAnalyser();
      an.fftSize = 1024;
      src.connect(an);
      an.connect(c.destination);
      st.fileAnalyser = an;
      st.fileSourceMade = true;
    },
    resume() { if (st.ctx) st.ctx.resume(); },
    level() { return Math.max(levelOf(st.micAnalyser), levelOf(st.fileAnalyser)); },
    micOn() { return !!st.micAnalyser; }
  };
}

// ── メインコンポーネント ──
function App() {
  const [t, setTweak] = useTweaks(TALK_DEFAULTS);
  const [cell, setCell] = useState({ r: 2, c: 2 });
  const [mouth, setMouth] = useState(0);
  const [blink, setBlink] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micErr, setMicErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [camErr, setCamErr] = useState('');
  const [showHud, setShowHud] = useState(true);
  const [videoEl, setVideoEl] = useState(null);
  const [camReady, setCamReady] = useState(false);
  const [faceInfo, setFaceInfo] = useState({ yaw: 0, pitch: 0, blink: false, ear: 0.3 });

  const charRef = useRef(null);
  const audioElRef = useRef(null);
  const meterRef = useRef(null);
  const videoRef = useRef(null);
  const previewRef = useRef(null);
  const engine = useMemo(() => makeAudioEngine(), []);
  const env = useRef(0);
  const tweaksRef = useRef(t);
  tweaksRef.current = t;

  // ── HUD非表示ショートカット（Hキー） ──
  useEffect(() => {
    function onKeyDown(e) {
      // input要素やcontentEditable内では無視
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === 'h' || e.key === 'H') {
        setShowHud(prev => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ── Webカメラ起動 ──
  useEffect(() => {
    let stream;
    async function startCam() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' }
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
          setVideoEl(videoRef.current);
          if (previewRef.current) {
            previewRef.current.srcObject = stream;
            previewRef.current.play().catch(() => {});
          }
          setCamReady(true);
        }
      } catch (e) {
        setCamErr('カメラにアクセスできません（権限を確認してください）');
      }
    }
    startCam();
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      setCamReady(false);
    };
  }, []);

  // ── MediaPipe顔追従 ──
  const faceOpts = useMemo(() => ({
    smoothing: t.smoothing,
    yawSens: t.yawSens,
    pitchSens: t.pitchSens,
    blinkThreshold: t.blinkThreshold,
  }), [t.smoothing, t.yawSens, t.pitchSens, t.blinkThreshold]);

  const onFaceResult = useCallback((result) => {
    setFaceInfo(result);
    setBlink(result.blink);

    // 顔の向き → グリッドセル
    // yaw: -1(左) 〜 +1(右) → col: 0(左) 〜 4(右)
    // pitch: -1(上) 〜 +1(下) → row: 0(上) 〜 4(下)
    const c = clamp(Math.round((result.yaw + 1) / 2 * (COLS - 1)), 0, COLS - 1);
    const r = clamp(Math.round((-result.pitch + 1) / 2 * (ROWS - 1)), 0, ROWS - 1);
    setCell(prev => prev.r !== r || prev.c !== c ? { r, c } : prev);
  }, [COLS, ROWS]);

  useFaceTracking(videoEl, faceOpts, onFaceResult);

  // ── 音声レベル → 口段階（メインループ） ──
  useEffect(() => {
    let raf;
    let lastMouth = 0;
    let lastSwitch = 0;
    function tick(now) {
      const tw = tweaksRef.current;
      const raw = engine.level() * tw.micGain;
      // エンベロープ追従
      if (raw > env.current) env.current += (raw - env.current) * 0.6;
      else env.current += (raw - env.current) * tw.release;
      // メーター更新
      if (meterRef.current) {
        meterRef.current.style.width = `${clamp(env.current / 0.4, 0, 1) * 100}%`;
      }
      // 音量 → 口パク（とじ/はんびらき/ぜんかい）
      const lv = env.current;
      const m = lv >= tw.thFull ? 2 : lv >= tw.thHalf ? 1 : 0;
      if (m !== lastMouth && now - lastSwitch > 70) {
        lastMouth = m;
        lastSwitch = now;
        setMouth(m);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // ── カメラプレビュー表示切替 ──
  useEffect(() => {
    if (t.showCamera && previewRef.current && videoRef.current?.srcObject) {
      previewRef.current.srcObject = videoRef.current.srcObject;
      previewRef.current.play().catch(() => {});
    }
  }, [t.showCamera]);

  // ── マイク制御 ──
  async function toggleMic() {
    setMicErr('');
    if (micOn) { engine.stopMic(); setMicOn(false); return; }
    try {
      await engine.startMic();
      setMicOn(true);
    } catch (e) {
      setMicErr('マイクを使用できません（権限を確認してください）');
    }
  }

  function onFilePick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const el = audioElRef.current;
    engine.attachAudioEl(el);
    engine.resume();
    el.src = URL.createObjectURL(f);
    el.play().catch(() => {});
    setFileName(f.name);
  }

  // ── 全フレーム事前生成 ──
  const allFrames = useMemo(() => {
    const arr = [];
    for (const s of SHEETS) for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arr.push({ s, r, c });
    return arr;
  }, []);

  const activeSheet = sheetFor(blink, mouth);

  // ── スタイル ──
  const dark = t.bgColor === '#2B2926';
  const inkColor = dark ? 'rgba(255,248,238,0.85)' : 'rgba(60,48,38,0.8)';
  const subColor = dark ? 'rgba(255,248,238,0.45)' : 'rgba(60,48,38,0.45)';
  const panelBg = dark ? 'rgba(48,45,42,0.92)' : 'rgba(255,255,255,0.88)';
  const lineColor = dark ? 'rgba(255,248,238,0.14)' : 'rgba(60,48,38,0.12)';
  const sizeVmin = t.charSize * 4 / 3;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: t.bgColor,
      overflow: 'hidden', transition: 'background 0.4s ease',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Zen Maru Gothic', sans-serif"
    }}>
      {/* 非表示のWebカメラvideo要素 */}
      <video ref={videoRef} playsInline muted
        style={{ position: 'fixed', top: -9999, left: -9999, width: 1, height: 1, opacity: 0 }}
      />

      {/* キャラクター */}
      <div ref={charRef} className="bob" style={{
        position: 'relative',
        width: `${sizeVmin}vmin`, height: `${sizeVmin}vmin`,
        maxWidth: 1200, maxHeight: 1200,
        userSelect: 'none',
      }}>
        {allFrames.map(({ s, r, c }) => (
          <img key={`${s}${r}${c}`} src={SRC(s, r, c)} alt="" draggable="false" style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            opacity: s === activeSheet && r === cell.r && c === cell.c ? 1 : 0,
            pointerEvents: 'none'
          }} />
        ))}
      </div>

      {/* タイトル */}
      {showHud ? (
      <div style={{ position: 'absolute', top: '3.5vh', left: 0, right: 0, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 'clamp(18px, 2.4vmin, 26px)', fontWeight: 700, color: inkColor, letterSpacing: '0.18em' }}>
          FaceTrack Talk
        </div>
        <div style={{ fontSize: 'clamp(12px, 1.6vmin, 16px)', color: subColor, marginTop: 4, letterSpacing: '0.08em' }}>
          {camErr ? camErr : (camReady ? 'カメラで顔を追従するよ' : 'カメラを起動中...')}
        </div>
      </div>
      ) : null}

      {/* カメラプレビュー */}
      {t.showCamera && camReady ? (
        <div style={{
          position: 'absolute', top: 18, right: 18,
          width: 200, borderRadius: 12, overflow: 'hidden',
          border: `2px solid ${lineColor}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          background: '#000',
        }}>
          <video ref={previewRef} playsInline muted
            style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }}
          />
          <div style={{
            position: 'absolute', bottom: 4, left: 8, right: 8,
            display: 'flex', justifyContent: 'space-between',
            fontSize: 10, color: '#fff', fontFamily: 'ui-monospace, monospace',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}>
            <span>yaw: {faceInfo.yaw.toFixed(2)}</span>
            <span>pitch: {faceInfo.pitch.toFixed(2)}</span>
            <span>EAR: {faceInfo.ear.toFixed(2)}</span>
          </div>
        </div>
      ) : null}

      {/* デバッグ: グリッド表示 */}
      {t.showDebug ? (
        <div style={{
          position: 'absolute', top: 16, left: 16,
          background: 'rgba(0,0,0,0.55)', color: '#fff', borderRadius: 10,
          padding: '10px 12px', fontSize: 12, fontFamily: 'ui-monospace, monospace',
          pointerEvents: 'none', lineHeight: 1.5
        }}>
          <div>row {cell.r} / col {cell.c}</div>
          <div>mouth: {['とじ','はんびらき','ぜんかい'][mouth]}</div>
          <div>blink: {blink ? 'ON' : 'OFF'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 14px)', gap: 3, marginTop: 6 }}>
            {Array.from({ length: ROWS * COLS }, (_, i) => {
              const r = Math.floor(i / COLS), c = i % COLS;
              return <div key={`d${r}-${c}`} style={{
                width: 14, height: 14, borderRadius: 3,
                background: r === cell.r && c === cell.c ? '#FFB13D' : 'rgba(255,255,255,0.22)'
              }} />;
            })}
          </div>
        </div>
      ) : null}

      {/* 下部コントロールパネル */}
      {showHud ? (
      <div style={{
        position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 14,
        background: panelBg, backdropFilter: 'blur(10px)',
        border: `1px solid ${lineColor}`, borderRadius: 18,
        padding: '12px 18px', cursor: 'default',
        boxShadow: '0 6px 24px rgba(60,48,38,0.10)'
      }}>
        {/* マイクボタン */}
        <button onClick={toggleMic} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'inherit', fontWeight: 700, fontSize: 14,
          color: micOn ? '#fff' : inkColor,
          background: micOn ? '#D96C4F' : 'transparent',
          border: `1.5px solid ${micOn ? '#D96C4F' : lineColor}`,
          borderRadius: 12, padding: '9px 16px', cursor: 'pointer',
          minHeight: 44
        }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: micOn ? '#fff' : '#D96C4F',
            animation: micOn ? 'pulse 1.2s ease-in-out infinite' : 'none'
          }} />
          {micOn ? 'マイク停止' : 'マイク開始'}
        </button>

        {/* 音声ファイル選択 */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontWeight: 700, fontSize: 14, color: inkColor,
          border: `1.5px solid ${lineColor}`, borderRadius: 12,
          padding: '9px 16px', cursor: 'pointer', minHeight: 44, boxSizing: 'border-box'
        }}>
          ♪ 音声ファイル
          <input type="file" accept="audio/*" onChange={onFilePick} style={{ display: 'none' }} />
        </label>

        {/* 音量メーター */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 150 }}>
          <div style={{ fontSize: 11, color: subColor, letterSpacing: '0.06em', display: 'flex', justifyContent: 'space-between' }}>
            <span>音量</span>
            <span>{['とじ', 'はんびらき', 'ぜんかい'][mouth]}</span>
          </div>
          <div style={{ position: 'relative', height: 10, borderRadius: 5, background: lineColor, overflow: 'hidden' }}>
            <div ref={meterRef} style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '0%',
              borderRadius: 5, background: 'linear-gradient(90deg, #8FBC8F, #E8B04B, #D96C4F)'
            }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: inkColor, opacity: 0.5, left: `${clamp(t.thHalf / 0.4, 0, 1) * 100}%` }} />
            <div style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: inkColor, opacity: 0.5, left: `${clamp(t.thFull / 0.4, 0, 1) * 100}%` }} />
          </div>
        </div>

        {/* カメラプレビュー切替 */}
        <button onClick={() => setTweak('showCamera', !t.showCamera)} style={{
          fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
          color: t.showCamera ? '#fff' : inkColor,
          background: t.showCamera ? '#6B8E7B' : 'transparent',
          border: `1.5px solid ${t.showCamera ? '#6B8E7B' : lineColor}`,
          borderRadius: 12, padding: '9px 14px', cursor: 'pointer',
          minHeight: 44
        }}>
          📷 {t.showCamera ? 'カメラ隠す' : 'カメラ表示'}
        </button>
      </div>
      ) : null}

      {/* エラー表示 */}
      {showHud && micErr ? (
        <div style={{ position: 'absolute', bottom: 92, left: '50%', transform: 'translateX(-50%)', color: '#B3261E', fontSize: 13, fontWeight: 700 }}>{micErr}</div>
      ) : null}
      {camErr ? (
        <div style={{ position: 'absolute', top: '8vh', left: '50%', transform: 'translateX(-50%)', color: '#B3261E', fontSize: 13, fontWeight: 700 }}>{camErr}</div>
      ) : null}

      {/* 音声プレイヤー */}
      {showHud ? (
      <audio ref={audioElRef} controls style={{
        position: 'absolute', bottom: 20, right: 20, width: 260,
        display: fileName ? 'block' : 'none', cursor: 'default'
      }} />
      ) : null}

      {/* Tweaksパネル */}
      {showHud ? (
      <TweaksPanel title="FaceTrack">
        <TweakSection label="顔追従" />
        <TweakSlider label="追従速度" value={t.smoothing} min={0.05} max={0.6} step={0.01}
          onChange={(v) => setTweak('smoothing', v)} />
        <TweakSlider label="左右感度" value={t.yawSens} min={5} max={60} step={1} unit="°"
          onChange={(v) => setTweak('yawSens', v)} />
        <TweakSlider label="上下感度" value={t.pitchSens} min={5} max={60} step={1} unit="°"
          onChange={(v) => setTweak('pitchSens', v)} />
        <TweakSlider label="まばたきしきい値" value={t.blinkThreshold} min={0.1} max={0.4} step={0.01}
          onChange={(v) => setTweak('blinkThreshold', v)} />

        <TweakSection label="口パク（音量）" />
        <TweakSlider label="マイク感度" value={t.micGain} min={0.3} max={5} step={0.1}
          onChange={(v) => setTweak('micGain', v)} />
        <TweakSlider label="しきい値（はんびらき）" value={t.thHalf} min={0.01} max={0.3} step={0.005}
          onChange={(v) => setTweak('thHalf', v)} />
        <TweakSlider label="しきい値（ぜんかい）" value={t.thFull} min={0.05} max={0.4} step={0.005}
          onChange={(v) => setTweak('thFull', v)} />
        <TweakSlider label="口を閉じる速さ" value={t.release} min={0.03} max={0.4} step={0.01}
          onChange={(v) => setTweak('release', v)} />

        <TweakSection label="見た目" />
        <TweakSlider label="キャラサイズ" value={t.charSize} min={30} max={92} unit="vmin"
          onChange={(v) => setTweak('charSize', v)} />
        <TweakColor label="背景色" value={t.bgColor} options={BG_OPTIONS}
          onChange={(v) => setTweak('bgColor', v)} />
        <TweakColor label="カスタム色" value={t.customBgColor}
          onChange={(v) => { setTweak('customBgColor', v); setTweak('bgColor', v); }} />
        <TweakToggle label="カメラプレビュー" value={t.showCamera}
          onChange={(v) => setTweak('showCamera', v)} />
        <TweakToggle label="デバッグ表示" value={t.showDebug}
          onChange={(v) => setTweak('showDebug', v)} />
      </TweaksPanel>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
