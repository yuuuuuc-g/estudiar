const sampleText = `# Entendiendo a China: El Triángulo de Poder, Riqueza y Estatus

Para entender la complejidad de la sociedad china, es necesario salir de los límites de una sola disciplina y analizar un problema central: la asignación de recursos escasos. Si algo está al alcance de todos sin generar conflictos, no constituye un problema de asignación en el sentido estricto. Sin embargo, en una sociedad burocrática, la escasez dicta las reglas del juego.

Para ver esto claramente, usamos un triángulo. El primer vértice es el poder y la autoridad; el segundo, la riqueza y la propiedad; y el tercero, el estatus social.

Tomemos como ejemplo la historia económica reciente. La reforma de coparticipación de impuestos de 1994 reconfiguró la distribución del poder fiscal entre el gobierno central y los locales. Para compensar el déficit de recaudación, los gobiernos locales crearon una nueva escasez al monopolizar la oferta de tierras, lo que dio lugar a la financiación basada en bienes raíces.

This triggered a chain reaction. Whatever resources are associated with infrastructure and real estate have become economic resources, which ultimately translate into a scarcity of social status within society. Suddenly, the household registration system (hukou), education, and real estate became deeply tied together.`;

const glossary = new Map([
  ["scarce resources", "稀缺资源"],
  ["allocation", "分配"],
  ["official-oriented society", "官本位社会"],
  ["power", "权力"],
  ["authority", "权威"],
  ["wealth", "财富"],
  ["property", "财产"],
  ["status", "地位"],
  ["tax-sharing reform", "分税制改革"],
  ["fiscal power", "财政权力"],
  ["land supply", "土地供应"],
  ["land-based finance", "土地财政"],
  ["real estate", "房地产"],
  ["household registration system", "户籍制度"],
  ["social welfare", "社会福利"],
  ["recursos escasos", "稀缺资源"],
  ["asignación", "分配"],
  ["sociedad burocrática", "官本位社会"],
  ["poder", "权力"],
  ["autoridad", "权威"],
  ["riqueza", "财富"],
  ["propiedad", "财产"],
  ["estatus social", "社会地位"],
  ["coparticipación de impuestos", "分税制"],
  ["poder fiscal", "财政权力"],
  ["oferta de tierras", "土地供应"],
  ["bienes raíces", "房地产"],
  ["bienestar social", "社会福利"]
]);

const elements = {
  workspace: document.querySelector(".workspace"),
  inspector: document.querySelector(".inspector"),
  sourceInput: document.querySelector("#sourceInput"),
  preview: document.querySelector("#preview"),
  resizeHandle: document.querySelector("#resizeHandle"),
  editTab: document.querySelector("#editTab"),
  previewTab: document.querySelector("#previewTab"),
  languageSelect: document.querySelector("#languageSelect"),
  speakButton: document.querySelector("#speakButton"),
  exportAudioButton: document.querySelector("#exportAudioButton"),
  selectedText: document.querySelector("#selectedText"),
  translation: document.querySelector("#translation"),
  analysis: document.querySelector("#analysis"),
  terms: document.querySelector("#terms"),
  statusDot: document.querySelector("#statusDot"),
  rateInput: document.querySelector("#rateInput"),
  pitchInput: document.querySelector("#pitchInput"),
  copySelectionButton: document.querySelector("#copySelectionButton"),
  voiceName: document.querySelector("#voiceName")
};

const voiceLabels = {
  "es-MX": "Microsoft Edge TTS · es-MX-DaliaNeural",
  "en-US": "Microsoft Edge TTS · en-US-JennyNeural"
};

let currentSelection = "";
let selectionTimer = 0;
let analysisRequestId = 0;
let suppressPreviewClickUntil = 0;
let previewPointerStart = null;
let audioPlayer = new Audio();
let audioUrl = "";
let isAudioReady = false;
let backendTtsAvailable = true;
let browserUtterance = null;
let isBrowserSpeechActive = false;
let syncedReadingContextKey = "";
const inspectorWidthStorageKey = "estudiar.inspectorWidth";
const previewSelectionSuppressMs = 700;
const dragClickThreshold = 6;

elements.sourceInput.value = sampleText;
renderPreview();
updateVoiceName();
setupInspectorResize();
loadAppStatus();

elements.sourceInput.addEventListener("input", () => {
  renderPreview();
  resetAudio();
  syncedReadingContextKey = "";
});
elements.languageSelect.addEventListener("change", handleLanguageChange);
elements.editTab.addEventListener("click", () => setMode("edit"));
elements.previewTab.addEventListener("click", () => setMode("preview"));
elements.sourceInput.addEventListener("mouseup", handleSourceSelection);
elements.sourceInput.addEventListener("keyup", handleSourceSelection);
elements.preview.addEventListener("mousedown", handlePreviewPointerStart);
elements.preview.addEventListener("mouseup", handlePreviewSelection);
elements.preview.addEventListener("keyup", handlePreviewSelection);
elements.preview.addEventListener("click", handlePreviewClick);
elements.speakButton.addEventListener("click", toggleSpeech);
elements.exportAudioButton.addEventListener("click", exportSpeech);
elements.copySelectionButton.addEventListener("click", copySelection);
elements.rateInput.addEventListener("input", resetAudio);
elements.pitchInput.addEventListener("input", resetAudio);
audioPlayer.addEventListener("ended", resetSpeakButton);
audioPlayer.addEventListener("pause", () => {
  if (!audioPlayer.ended) setSpeakButton("play");
});
audioPlayer.addEventListener("play", () => setSpeakButton("pause"));

function handleLanguageChange() {
  resetAudio();
  syncedReadingContextKey = "";
  updateVoiceName();
}

async function loadAppStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) return;
    const payload = await response.json();
    backendTtsAvailable = payload.ttsAvailable !== false;
    updateVoiceName(payload.ttsProvider);
  } catch {
    backendTtsAvailable = true;
  }
}

function updateVoiceName(ttsProvider) {
  const voiceLabel = voiceLabels[elements.languageSelect.value] || "Microsoft Edge TTS";
  if (ttsProvider === "none" || !backendTtsAvailable) {
    elements.voiceName.textContent = `${voiceLabel} · 浏览器朗读`;
    return;
  }

  elements.voiceName.textContent = voiceLabel;
}

function setupInspectorResize() {
  const savedValue = localStorage.getItem(inspectorWidthStorageKey);
  const savedWidth = Number(savedValue);
  if (savedValue !== null && Number.isFinite(savedWidth)) {
    setInspectorWidth(savedWidth, false);
  }

  elements.resizeHandle.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width: 980px)").matches) return;

    event.preventDefault();
    elements.resizeHandle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-inspector");

    const move = (moveEvent) => {
      const rect = elements.workspace.getBoundingClientRect();
      setInspectorWidth(rect.right - moveEvent.clientX);
    };
    const stop = () => {
      document.body.classList.remove("resizing-inspector");
      elements.resizeHandle.removeEventListener("pointermove", move);
      elements.resizeHandle.removeEventListener("pointerup", stop);
      elements.resizeHandle.removeEventListener("pointercancel", stop);
    };

    elements.resizeHandle.addEventListener("pointermove", move);
    elements.resizeHandle.addEventListener("pointerup", stop);
    elements.resizeHandle.addEventListener("pointercancel", stop);
  });

  elements.resizeHandle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    const currentWidth = getCurrentInspectorWidth();
    if (event.key === "Home") {
      setInspectorWidth(540);
      return;
    }
    if (event.key === "End") {
      setInspectorWidth(700);
      return;
    }

    const delta = event.shiftKey ? 40 : 20;
    setInspectorWidth(currentWidth + (event.key === "ArrowLeft" ? delta : -delta));
  });
}

function getCurrentInspectorWidth() {
  return elements.inspector?.getBoundingClientRect().width || 540;
}

function setInspectorWidth(width, persist = true) {
  const rect = elements.workspace.getBoundingClientRect();
  const minWidth = 500;
  const maxWidth = Math.max(minWidth, Math.min(820, rect.width - 460));
  const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(width)));

  elements.workspace.style.setProperty("--inspector-width", `${nextWidth}px`);
  if (persist) localStorage.setItem(inspectorWidthStorageKey, String(nextWidth));
}

function setMode(mode) {
  const isPreview = mode === "preview";
  elements.sourceInput.classList.toggle("hidden", isPreview);
  elements.preview.classList.toggle("hidden", !isPreview);
  elements.editTab.classList.toggle("active", !isPreview);
  elements.previewTab.classList.toggle("active", isPreview);
  if (isPreview) {
    renderPreview();
    syncReadingContext();
  }
}

function renderPreview() {
  elements.preview.innerHTML = markdownToHtml(elements.sourceInput.value);
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\n/);
  const html = [];
  let listOpen = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(bullet[1])}</li>`);
      continue;
    }

    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  if (listOpen) html.push("</ul>");
  return html.join("");
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}

function handleSourceSelection() {
  const start = elements.sourceInput.selectionStart;
  const end = elements.sourceInput.selectionEnd;
  if (start === end) return;

  scheduleSelectionAnalysis(elements.sourceInput.value.slice(start, end));
}

function handlePreviewPointerStart(event) {
  previewPointerStart = {
    x: event.clientX,
    y: event.clientY
  };
}

function handlePreviewSelection() {
  const selected = getPreviewSelectionText();
  if (!selected) return;

  suppressPreviewClickUntil = Date.now() + previewSelectionSuppressMs;
  scheduleSelectionAnalysis(selected);
}

function scheduleSelectionAnalysis(text) {
  clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    const selected = normalizeText(text);
    if (!selected || selected === currentSelection) return;
    analyzeText(selected, "语法解析");
  }, 180);
}

function selectionBelongsToPreview(selection) {
  const anchor = selection.anchorNode;
  const focus = selection.focusNode;
  return Boolean(
    anchor &&
      focus &&
      elements.preview.contains(anchor) &&
      elements.preview.contains(focus)
  );
}

function getPreviewSelectionText() {
  const selection = window.getSelection();
  if (!selection || !selection.toString().trim()) return "";
  if (!selectionBelongsToPreview(selection)) return "";
  return selection.toString().trim();
}

function handlePreviewClick(event) {
  const startedAsDrag =
    previewPointerStart &&
    Math.hypot(event.clientX - previewPointerStart.x, event.clientY - previewPointerStart.y) >
      dragClickThreshold;

  previewPointerStart = null;

  if (Date.now() < suppressPreviewClickUntil || startedAsDrag || getPreviewSelectionText()) {
    return;
  }

  const block = event.target.closest("p, li, h1, h2, h3");
  if (!block || !elements.preview.contains(block)) return;

  analyzeText(block.textContent, "段落语法");
}

async function analyzeText(text, label) {
  const requestId = ++analysisRequestId;
  currentSelection = normalizeText(text);
  elements.selectedText.textContent = currentSelection;
  resetAudio();
  setBusy(true);
  renderLocalResult(currentSelection, label);

  try {
    const requestPayload = {
      task: label === "全文语法" ? "parse_full_text_grammar" : "parse_selection_grammar",
      language: elements.languageSelect.value,
      text: currentSelection
    };

    if (!hasSyncedReadingContext()) {
      requestPayload.fullText = elements.sourceInput.value;
    }

    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    const payload = await response.json();
    const result = payload.result || payload;
    if (requestId !== analysisRequestId) return;
    applyAiResult(result, payload);
  } catch {
    if (requestId === analysisRequestId) {
      elements.analysis.textContent += "\n\nAI 代理暂不可用，已保留本地分析结果。";
    }
  } finally {
    if (requestId === analysisRequestId) setBusy(false);
  }
}

function renderLocalResult(text, label) {
  const terms = findTerms(text);
  const sentenceCount = text.split(/[.!?。！？]\s+/).filter(Boolean).length || 1;
  const wordCount = (text.match(/[\p{L}']+/gu) || []).length;

  elements.translation.textContent = buildGlossaryTranslation(text, terms);
  elements.translation.classList.remove("muted");
  elements.analysis.textContent = [
    `${label}：约 ${wordCount} 个词，${sentenceCount} 个句段。`,
    buildLocalGrammarNote(text),
    "断句提示：优先找谓语动词，再把介词短语、从句和插入语分开看。"
  ].join("\n");
  elements.analysis.classList.remove("muted");
  renderTerms(terms);
}

function applyAiResult(result, payload = {}) {
  const normalized = normalizeAiResult(result);

  if (normalized.translation) {
    elements.translation.textContent = cleanDisplayText(normalized.translation);
    elements.translation.classList.remove("muted");
  }

  const analysisText = formatAnalysisResult(normalized, payload);
  if (analysisText) {
    elements.analysis.textContent = analysisText;
    elements.analysis.classList.remove("muted");
  }

  if (Array.isArray(normalized.terms) && normalized.terms.length) {
    renderTerms(normalized.terms.map((item) => item.term || item).filter(Boolean));
  }
}

function normalizeAiResult(result) {
  let value = result;

  for (let attempts = 0; attempts < 3; attempts += 1) {
    if (typeof value !== "string") break;

    const cleaned = stripModelFences(value);
    try {
      value = JSON.parse(cleaned);
    } catch {
      return {
        translation: "",
        grammarAnalysis: cleaned,
        terms: [],
        readingTips: []
      };
    }
  }

  if (!value || typeof value !== "object") {
    return {
      translation: "",
      grammarAnalysis: String(value || ""),
      terms: [],
      readingTips: []
    };
  }

  return {
    translation: value.translation || "",
    grammarAnalysis: value.grammarAnalysis || value.summary || value.analysis || "",
    terms: Array.isArray(value.terms) ? value.terms : [],
    readingTips: Array.isArray(value.readingTips) ? value.readingTips : []
  };
}

function formatAnalysisResult(result, payload = {}) {
  const sections = [];
  const grammar = cleanDisplayText(result.grammarAnalysis);
  const tips = result.readingTips.map(cleanDisplayText).filter(Boolean);

  if (grammar) sections.push(`语法解析\n${grammar}`);
  if (tips.length) {
    sections.push(`跟读建议\n${tips.map((tip, index) => `${index + 1}. ${tip}`).join("\n")}`);
  }

  const modelNote =
    payload.source === "deepseek"
      ? `模型：${payload.model || "deepseek-v4-pro"}${payload.cached ? " · 已缓存" : ""}`
      : "未读取到 DEEPSEEK_API_KEY，当前为本地模式。请确认 .env 已保存；服务会在下一次请求前重新读取 .env。";
  const errorNote = payload.error ? `DeepSeek 调用失败：${payload.error}` : "";

  sections.push([modelNote, errorNote].filter(Boolean).join("\n"));
  return sections.filter(Boolean).join("\n\n");
}

function stripModelFences(value) {
  return String(value || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildLocalGrammarNote(text) {
  const lower = text.toLowerCase();
  const signals = [];

  if (/\b(which|that|who|where|when|whose)\b/i.test(text)) {
    signals.push("包含关系词，注意它引导的从句修饰哪个名词或补充哪层信息。");
  }
  if (/\b(if|because|since|although|while|when|as|para|si|porque|aunque|cuando)\b/i.test(text)) {
    signals.push("包含从属连词，可先区分主句和原因、条件、让步或时间状语从句。");
  }
  if (/\b(is|are|was|were|be|been|ser|estar|es|son|fue|eran)\b/i.test(text)) {
    signals.push("出现系动词或被动结构线索，留意主语、表语或过去分词短语。");
  }
  if (lower.includes(" de ") || lower.includes(" of ")) {
    signals.push("包含 of/de 结构，常用于名词后置限定，翻译时可从后往前梳理。");
  }

  return signals.length
    ? `语法线索：${signals.slice(0, 2).join("")}`
    : "语法线索：先标出主语、谓语和宾语/表语，再处理修饰语和连接词。";
}

function buildGlossaryTranslation(text, terms) {
  if (!terms.length) {
    return "已选择文本。当前本地模式会先抽取关键词；接入 AI 后将生成自然中文翻译。";
  }

  const pairs = terms.map((term) => `${term}：${glossary.get(term.toLowerCase()) || "待 AI 精译"}`);
  return `关键词译解\n${pairs.join("\n")}\n\n接入 AI 后，这里会输出完整中文译文。`;
}

function findTerms(text) {
  const lower = text.toLowerCase();
  const terms = [];

  for (const [term] of glossary) {
    if (lower.includes(term.toLowerCase())) terms.push(term);
  }

  const longWords = text.match(/[\p{L}']{8,}/gu) || [];
  for (const word of longWords) {
    if (terms.length >= 12) break;
    if (!terms.some((term) => term.toLowerCase() === word.toLowerCase())) {
      terms.push(word);
    }
  }

  return terms.slice(0, 12);
}

function renderTerms(terms) {
  elements.terms.innerHTML = "";

  if (!terms.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = "暂无重点词。";
    elements.terms.append(empty);
    return;
  }

  for (const term of terms) {
    const chip = document.createElement("span");
    chip.className = "term";
    chip.textContent = term;
    elements.terms.append(chip);
  }
}

async function toggleSpeech() {
  if (isBrowserSpeechActive) {
    stopBrowserSpeech();
    setSpeakButton("play");
    return;
  }

  if (!audioPlayer.paused) {
    audioPlayer.pause();
    setSpeakButton("play");
    return;
  }

  if (isAudioReady) {
    await audioPlayer.play();
    return;
  }

  const text = getActiveSpeechText();
  if (!text.trim()) return;

  if (!backendTtsAvailable) {
    if (!playBrowserSpeech(text)) {
      handleSpeechError(new Error("当前浏览器不支持内置朗读。配置 Azure Speech 后可启用服务器语音。"));
    }
    return;
  }

  try {
    await prepareSpeechAudio(text);
    await audioPlayer.play();
  } catch (error) {
    if (!playBrowserSpeech(text)) {
      handleSpeechError(error);
    }
  }
}

async function exportSpeech() {
  const text = getActiveSpeechText();
  if (!text.trim()) return;

  if (!backendTtsAvailable) {
    handleSpeechError(new Error("当前部署未配置 Azure Speech，无法导出 MP3；播放会使用浏览器内置朗读。"));
    return;
  }

  try {
    await prepareSpeechAudio(text);
    downloadAudio();
  } catch (error) {
    handleSpeechError(error);
  }
}

async function syncReadingContext() {
  const text = elements.sourceInput.value.trim();
  if (!text) return;

  const contextKey = buildReadingContextKey();
  if (contextKey === syncedReadingContextKey) return;

  try {
    const response = await fetch("/api/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: elements.languageSelect.value
      })
    });

    if (response.ok && contextKey === buildReadingContextKey()) {
      syncedReadingContextKey = contextKey;
    }
  } catch {
    syncedReadingContextKey = "";
  }
}

function hasSyncedReadingContext() {
  return Boolean(syncedReadingContextKey && syncedReadingContextKey === buildReadingContextKey());
}

function buildReadingContextKey() {
  return `${elements.languageSelect.value}\n${elements.sourceInput.value.trim()}`;
}

function getActiveSpeechText() {
  return currentSelection.trim();
}

async function prepareSpeechAudio(text) {
  stopBrowserSpeech();

  if (audioUrl) {
    isAudioReady = true;
    return;
  }

  setSpeakButton("loading");
  setExportButton("loading");

  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language: elements.languageSelect.value,
      rate: Number(elements.rateInput.value),
      pitch: Number(elements.pitchInput.value)
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.error || "TTS request failed");
  }

  const audioBlob = await response.blob();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(audioBlob);
  audioPlayer.src = audioUrl;
  isAudioReady = true;
  setSpeakButton("play");
  setExportButton("ready");
}

function downloadAudio() {
  if (!audioUrl) return;

  const link = document.createElement("a");
  link.href = audioUrl;
  link.download = buildAudioFileName();
  document.body.append(link);
  link.click();
  link.remove();
}

function buildAudioFileName() {
  const language = elements.languageSelect.value.toLowerCase();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `estudiar-${language}-${timestamp}.mp3`;
}

function handleSpeechError(error) {
  isAudioReady = false;
  setSpeakButton("play");
  setExportButton("ready");
  elements.analysis.textContent += `\n\n语音生成失败：${error instanceof Error ? error.message : String(error)}`;
}

function resetAudio() {
  stopBrowserSpeech();
  audioPlayer.pause();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = "";
  isAudioReady = false;
  setSpeakButton("play");
  setExportButton("ready");
}

function playBrowserSpeech(text) {
  if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    return false;
  }

  stopBrowserSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = elements.languageSelect.value;
  utterance.rate = Number(elements.rateInput.value) || 1;
  utterance.pitch = Number(elements.pitchInput.value) || 1;

  const voices = window.speechSynthesis.getVoices();
  const matchingVoice = voices.find((voice) => voice.lang === utterance.lang);
  if (matchingVoice) utterance.voice = matchingVoice;

  utterance.addEventListener("start", () => {
    isBrowserSpeechActive = true;
    setSpeakButton("pause");
  });
  utterance.addEventListener("end", () => {
    isBrowserSpeechActive = false;
    browserUtterance = null;
    setSpeakButton("play");
  });
  utterance.addEventListener("error", () => {
    isBrowserSpeechActive = false;
    browserUtterance = null;
    setSpeakButton("play");
  });

  browserUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  return true;
}

function stopBrowserSpeech() {
  if (!("speechSynthesis" in window)) return;
  if (isBrowserSpeechActive || window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
  isBrowserSpeechActive = false;
  browserUtterance = null;
}

function setSpeakButton(state) {
  const icon = elements.speakButton.querySelector("span");
  if (state === "pause") {
    icon.textContent = "⏸";
    elements.speakButton.title = "暂停语音";
    elements.speakButton.setAttribute("aria-label", "暂停语音");
    return;
  }

  if (state === "loading") {
    icon.textContent = "…";
    elements.speakButton.title = "生成语音中";
    elements.speakButton.setAttribute("aria-label", "生成语音中");
    return;
  }

  icon.textContent = "▶";
  elements.speakButton.title = "朗读当前选区";
  elements.speakButton.setAttribute("aria-label", "朗读当前选区");
}

function resetSpeakButton() {
  isAudioReady = false;
  setSpeakButton("play");
}

function setExportButton(state) {
  const icon = elements.exportAudioButton.querySelector("span");
  if (state === "loading") {
    icon.textContent = "…";
    elements.exportAudioButton.title = "生成导出音频中";
    elements.exportAudioButton.setAttribute("aria-label", "生成导出音频中");
    elements.exportAudioButton.disabled = true;
    return;
  }

  icon.textContent = "↓";
  elements.exportAudioButton.title = "导出当前语音";
  elements.exportAudioButton.setAttribute("aria-label", "导出当前语音");
  elements.exportAudioButton.disabled = false;
}

async function copySelection() {
  if (!currentSelection) return;
  await navigator.clipboard.writeText(currentSelection);
  elements.copySelectionButton.textContent = "已复制";
  window.setTimeout(() => {
    elements.copySelectionButton.textContent = "复制";
  }, 1200);
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function setBusy(isBusy) {
  elements.statusDot.classList.toggle("busy", isBusy);
}
