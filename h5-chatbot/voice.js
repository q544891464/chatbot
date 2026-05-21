import { formatRuntimeError, readResponseError } from "./utils.js";

export function createVoiceInput(options) {
  const { el, state, getStoreBase, sendMessage, setTips, updateTextareaHeight } = options;
  const voiceState = {
    recording: false,
    transcribing: false,
    stream: null,
    audioContext: null,
    source: null,
    processor: null,
    chunks: [],
    sampleRate: 16000,
    timer: 0,
  };

  function setUi(status) {
    if (!el.voiceBtn) return;
    const recording = status === "recording";
    const transcribing = status === "transcribing";
    voiceState.recording = recording;
    voiceState.transcribing = transcribing;
    el.voiceBtn.classList.toggle("is-recording", recording);
    el.voiceBtn.classList.toggle("is-transcribing", transcribing);
    el.voiceBtn.disabled = state.accessDenied || Boolean(state.inFlight) || transcribing;
    el.voiceBtn.title = recording ? "结束录音" : transcribing ? "正在识别" : "语音输入";
    el.voiceBtn.setAttribute("aria-label", el.voiceBtn.title);
  }

  function cleanupRecorder() {
    if (voiceState.timer) {
      window.clearTimeout(voiceState.timer);
      voiceState.timer = 0;
    }
    try {
      voiceState.processor?.disconnect();
      voiceState.source?.disconnect();
    } catch {
      // ignore recorder cleanup errors
    }
    try {
      voiceState.stream?.getTracks().forEach((track) => track.stop());
    } catch {
      // ignore recorder cleanup errors
    }
    if (voiceState.audioContext && voiceState.audioContext.state !== "closed") {
      voiceState.audioContext.close().catch(() => {});
    }
    voiceState.stream = null;
    voiceState.audioContext = null;
    voiceState.source = null;
    voiceState.processor = null;
  }

  function mergeAudioChunks(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  function resampleAudio(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const length = Math.max(1, Math.round(input.length / ratio));
    const output = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const sourceIndex = i * ratio;
      const before = Math.floor(sourceIndex);
      const after = Math.min(before + 1, input.length - 1);
      const weight = sourceIndex - before;
      output[i] = input[before] * (1 - weight) + input[after] * weight;
    }
    return output;
  }

  function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    const writeString = (offset, value) => {
      for (let i = 0; i < value.length; i += 1) {
        view.setUint8(offset + i, value.charCodeAt(i));
      }
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);
    let offset = 44;
    for (const sample of samples) {
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  function pickAudioText(data) {
    const sources = [data, data?.raw, data?.raw?.data, data?.data, data?.result];
    const keys = ["text", "content", "transcript", "transcription", "message", "answer"];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      for (const key of keys) {
        const value = String(source[key] || "").trim();
        if (value) return value;
      }
    }
    return "";
  }

  async function transcribeAudio(blob, filename = "recording.wav") {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("user", "lndx");
    const res = await fetch(`${getStoreBase()}/audio-to-text`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      throw new Error(await readResponseError(res, "语音识别失败"));
    }
    const data = await res.json().catch(() => ({}));
    const text = pickAudioText(data);
    if (!text) throw new Error("语音识别失败：没有识别到文字");
    return text;
  }

  async function submitFile(file) {
    if (!file || state.accessDenied || state.inFlight || voiceState.transcribing) return;
    setUi("transcribing");
    setTips("正在识别语音...");
    try {
      const text = await transcribeAudio(file, file.name || "recording.wav");
      el.input.value = text;
      updateTextareaHeight();
      setTips("");
      await sendMessage();
    } catch (err) {
      setTips(String(err?.message || err || "语音识别失败"));
    } finally {
      setUi("idle");
      if (el.voiceFileInput) el.voiceFileInput.value = "";
    }
  }

  async function start() {
    if (state.accessDenied || state.inFlight || voiceState.transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setTips(window.isSecureContext ? "当前浏览器不支持录音。" : "当前 HTTPS 证书未被浏览器信任，无法调用麦克风。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      voiceState.stream = stream;
      voiceState.audioContext = audioContext;
      voiceState.source = source;
      voiceState.processor = processor;
      voiceState.sampleRate = audioContext.sampleRate;
      voiceState.chunks = [];
      processor.onaudioprocess = (event) => {
        if (!voiceState.recording) return;
        voiceState.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
      setUi("recording");
      setTips("正在录音，再点一次结束并发送。");
      voiceState.timer = window.setTimeout(() => {
        stop().catch((err) => setTips(String(err?.message || err || "语音识别失败")));
      }, 55000);
    } catch (err) {
      cleanupRecorder();
      setUi("idle");
      setTips(formatRuntimeError(err, "无法开始录音，请检查麦克风权限"));
    }
  }

  async function stop() {
    if (!voiceState.recording) return;
    const chunks = voiceState.chunks.slice();
    const sampleRate = voiceState.sampleRate;
    cleanupRecorder();
    setUi("transcribing");
    setTips("正在识别语音...");
    try {
      const merged = mergeAudioChunks(chunks);
      if (merged.length < sampleRate * 0.25) {
        throw new Error("录音时间太短，请重新录入。");
      }
      const samples = resampleAudio(merged, sampleRate, 16000);
      const wav = encodeWav(samples, 16000);
      const text = await transcribeAudio(wav);
      el.input.value = text;
      updateTextareaHeight();
      setTips("");
      await sendMessage();
    } catch (err) {
      setTips(String(err?.message || err || "语音识别失败"));
    } finally {
      voiceState.chunks = [];
      setUi("idle");
    }
  }

  function toggle() {
    if (voiceState.recording) {
      stop();
      return;
    }
    start();
  }

  return {
    isRecording: () => voiceState.recording,
    isTranscribing: () => voiceState.transcribing,
    setUi,
    start,
    stop,
    submitFile,
    toggle,
  };
}
