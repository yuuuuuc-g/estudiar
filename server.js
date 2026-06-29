import http from "node:http";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

loadEnvFile(join(root, ".env"));

const port = Number(process.env.PORT || 3000);
const maxAnalysisCacheEntries = 60;
const maxWarmSegments = 6;
const readingContext = {
  key: "",
  text: "",
  language: "es-MX",
  status: "idle",
  warmedAt: 0,
  error: ""
};
const analysisCache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export async function handleRequest(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "POST" && url.pathname === "/api/ai") {
    await handleAi(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tts") {
    await handleTts(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/context") {
    await handleReadingContext(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/status") {
    loadEnvFile(join(root, ".env"), { overwrite: true });
    sendJson(response, 200, {
      deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro",
      baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
    });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = normalize(join(root, pathname));

  if (!target.startsWith(root)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(target)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(handleRequest);

async function handleAi(request, response) {
  try {
    loadEnvFile(join(root, ".env"), { overwrite: true });

    const body = await readRequestBody(request);
    const payload = hydrateAiPayload(JSON.parse(body || "{}"));
    sendJson(response, 200, await completeAi(payload));
  } catch (error) {
    sendJson(response, 500, {
      error: "AI request failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleReadingContext(request, response) {
  try {
    loadEnvFile(join(root, ".env"), { overwrite: true });

    const body = await readRequestBody(request);
    const payload = JSON.parse(body || "{}");
    const text = String(payload.text || "").trim();
    const language = payload.language || "es-MX";

    if (!text) {
      sendJson(response, 400, { error: "Missing text for reading context" });
      return;
    }

    const key = buildContextKey(language, text);
    if (readingContext.key === key) {
      sendJson(response, 202, {
        key,
        status: readingContext.status,
        warmedAt: readingContext.warmedAt,
        error: readingContext.error
      });
      return;
    }

    Object.assign(readingContext, {
      key,
      text,
      language,
      status: "warming",
      warmedAt: 0,
      error: ""
    });

    warmReadingContext(key, text, language);
    sendJson(response, 202, { key, status: "warming" });
  } catch (error) {
    sendJson(response, 500, {
      error: "Reading context request failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleTts(request, response) {
  try {
    loadEnvFile(join(root, ".env"), { overwrite: true });

    const body = await readRequestBody(request);
    const payload = JSON.parse(body || "{}");
    const text = String(payload.text || "").trim();
    if (!text) {
      sendJson(response, 400, { error: "Missing text for TTS" });
      return;
    }

    const voice = selectEdgeVoice(payload.language);
    const ttsResult = await synthesizeSpeech({
      text,
      voice,
      language: payload.language,
      rate: payload.rate,
      pitch: payload.pitch
    });
    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Content-Length": ttsResult.audio.length,
      "Cache-Control": "no-store",
      "X-Voice": voice,
      "X-TTS-Provider": ttsResult.provider
    });
    response.end(ttsResult.audio);
  } catch (error) {
    sendJson(response, 500, {
      error: "TTS request failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function synthesizeSpeech({ text, voice, language, rate, pitch }) {
  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) {
    return {
      provider: "azure-speech",
      audio: await synthesizeAzureSpeech({ text, voice, language, rate, pitch })
    };
  }

  return {
    provider: "edge-tts-cli",
    audio: await synthesizeEdgeCliSpeech({ text, voice, rate, pitch })
  };
}

async function synthesizeAzureSpeech({ text, voice, language, rate, pitch }) {
  const endpoint =
    process.env.AZURE_SPEECH_ENDPOINT ||
    `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = buildSpeechSsml({
    text,
    voice,
    language,
    rate: toEdgeRate(rate),
    pitch: toEdgePitch(pitch)
  });

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/ssml+xml",
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "estudiar-reader"
    },
    body: ssml
  });

  if (!upstream.ok) {
    const message = await upstream.text().catch(() => "");
    throw new Error(message || `Azure Speech returned ${upstream.status}`);
  }

  return Buffer.from(await upstream.arrayBuffer());
}

async function synthesizeEdgeCliSpeech({ text, voice, rate, pitch }) {
  const tempBase = join(tmpdir(), `estudiar-tts-${randomUUID()}`);
  const inputPath = `${tempBase}.txt`;
  const outputPath = `${tempBase}.mp3`;

  try {
    await writeFile(inputPath, text, "utf8");

    const command = process.env.EDGE_TTS_COMMAND || "edge-tts";
    const args = [
      "--file",
      inputPath,
      "--voice",
      voice,
      `--rate=${toEdgeRate(rate)}`,
      `--pitch=${toEdgePitch(pitch)}`,
      "--write-media",
      outputPath
    ];

    await runCommand(command, args);
    return await readFile(outputPath);
  } finally {
    await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
  }
}

async function completeAi(payload, options = {}) {
  const useCache = options.useCache !== false;
  const cacheKey = buildAnalysisCacheKey(payload);

  if (useCache && analysisCache.has(cacheKey)) {
    return { ...analysisCache.get(cacheKey), cached: true };
  }

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const apiUrl = process.env.AI_API_URL;
  const apiKey = process.env.AI_API_KEY;
  let result;

  if (deepseekKey) {
    result = await callDeepSeek(payload, deepseekKey);
  } else if (apiUrl && apiKey) {
    result = await callCustomAi(payload, apiUrl, apiKey);
  } else {
    result = {
      source: "local",
      reason: "missing_deepseek_api_key",
      result: localAnalyze(payload)
    };
  }

  setAnalysisCache(cacheKey, result);
  return result;
}

async function callCustomAi(payload, apiUrl, apiKey) {
  const upstream = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      task: payload.task,
      language: payload.language,
      text: payload.text,
      fullText: payload.fullText,
      instruction: buildGrammarInstruction(payload.language)
    })
  });

  const text = await upstream.text();
  let parsed;

  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { result: parseModelContent(text) };
  }

  if (!upstream.ok) {
    return {
      source: "custom",
      error: parsed.error?.message || parsed.message || "AI request failed",
      result: localAnalyze(payload)
    };
  }

  return parsed.result ? parsed : { source: "custom", result: parsed };
}

async function warmReadingContext(key, text, language) {
  try {
    await completeAi(
      hydrateAiPayload({
        task: "parse_full_text_grammar",
        language,
        text,
        fullText: text
      }),
      { useCache: false }
    );

    for (const segment of extractReadingSegments(text).slice(0, maxWarmSegments)) {
      if (readingContext.key !== key) return;
      await completeAi(
        hydrateAiPayload({
          task: "parse_selection_grammar",
          language,
          text: segment,
          fullText: text
        })
      );
    }

    if (readingContext.key === key) {
      readingContext.status = "ready";
      readingContext.warmedAt = Date.now();
    }
  } catch (error) {
    if (readingContext.key === key) {
      readingContext.status = "error";
      readingContext.error = error instanceof Error ? error.message : String(error);
    }
  }
}

function hydrateAiPayload(payload) {
  const language = payload.language || readingContext.language || "es-MX";
  const fullText =
    String(payload.fullText || "").trim() ||
    (readingContext.language === language ? readingContext.text : "");

  return {
    ...payload,
    language,
    text: String(payload.text || "").trim(),
    fullText
  };
}

function extractReadingSegments(text) {
  const seen = new Set();

  return text
    .split(/\n+/)
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/[*_`]+/g, "")
        .trim()
    )
    .filter((line) => {
      if (line.length < 18 || seen.has(line)) return false;
      seen.add(line);
      return true;
    });
}

function buildContextKey(language, text) {
  return `${language}:${hashText(text)}`;
}

function buildAnalysisCacheKey(payload) {
  return [
    payload.task || "parse_selection_grammar",
    payload.language || "es-MX",
    hashText(payload.text || ""),
    hashText(payload.fullText || "")
  ].join(":");
}

function hashText(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

function setAnalysisCache(key, value) {
  if (analysisCache.has(key)) analysisCache.delete(key);
  analysisCache.set(key, { ...value });

  while (analysisCache.size > maxAnalysisCacheEntries) {
    const oldestKey = analysisCache.keys().next().value;
    analysisCache.delete(oldestKey);
  }
}

async function callDeepSeek(payload, apiKey) {
  const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";

  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: buildGrammarInstruction(payload.language)
          },
          {
            role: "user",
            content: JSON.stringify({
              task: payload.task,
              selectedText: payload.text,
              fullText: payload.fullText
            })
          }
        ],
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        stream: false
      })
    });

    const text = await upstream.text();
    const json = text ? JSON.parse(text) : {};

    if (!upstream.ok) {
      return {
        source: "deepseek",
        model,
        error: json.error?.message || "DeepSeek request failed",
        result: localAnalyze(payload)
      };
    }

    return {
      source: "deepseek",
      model,
      result: parseModelContent(json.choices?.[0]?.message?.content)
    };
  } catch (error) {
    return {
      source: "deepseek",
      model,
      error: error instanceof Error ? error.message : String(error),
      result: localAnalyze(payload)
    };
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function selectEdgeVoice(language) {
  if (language === "en-US") {
    return process.env.EDGE_TTS_EN_US_VOICE || "en-US-JennyNeural";
  }

  return process.env.EDGE_TTS_ES_MX_VOICE || "es-MX-DaliaNeural";
}

function toEdgeRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return "+0%";
  const percent = Math.round((rate - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

function toEdgePitch(value) {
  const pitch = Number(value);
  if (!Number.isFinite(pitch)) return "+0Hz";
  const hertz = Math.round((pitch - 1) * 50);
  return `${hertz >= 0 ? "+" : ""}${hertz}Hz`;
}

function buildSpeechSsml({ text, voice, language, rate, pitch }) {
  const locale = language || voice.split("-").slice(0, 2).join("-") || "es-MX";

  return [
    `<speak version="1.0" xml:lang="${escapeXml(locale)}" xmlns="http://www.w3.org/2001/10/synthesis">`,
    `<voice name="${escapeXml(voice)}">`,
    `<prosody rate="${escapeXml(rate)}" pitch="${escapeXml(pitch)}">`,
    escapeXml(text),
    "</prosody>",
    "</voice>",
    "</speak>"
  ].join("");
}

function escapeXml(value) {
  return String(value || "").replace(/[<>&'"]/g, (char) => {
    return {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;"
    }[char];
  });
}

function buildGrammarInstruction(language) {
  const targetLanguage =
    language === "es-MX"
      ? "墨西哥西班牙语（Español de México）。注意西语词序、性数一致、动词变位、介词搭配和从句结构。"
      : "英语。注意句子成分、时态语态、从句、非谓语结构、介词短语和学术长句结构。";

  return [
    "你是一个中文母语者的外语语法解析导师。",
    `当前阅读语言：${targetLanguage}`,
    "核心任务是解析 selectedText 的语法，不要分析 selectedText 在全文中的论证作用、主题作用、修辞作用或内容意义。",
    "fullText 只可用于消除指代或省略造成的语法歧义，不要据此扩展成文章结构分析。",
    "如果 selectedText 是词或短语，说明词性、形态变化、搭配和它在句中的语法功能；如果是句子或段落，先给自然中文译文，再解析主干、从句、短语修饰、时态语态、连接词和易错点。",
    "translation 必须是 selectedText 的自然中文译文，不要留空；grammarAnalysis 必须是普通中文纯文本，不要使用 Markdown 标题、表格、代码块或 JSON 字符串。",
    "保留必要专有名词，例如 hukou；制度术语可用中文通行译名。terms 中优先列语法点、固定搭配和影响句法理解的关键词。",
    "只返回 JSON，不要 Markdown，不要代码块。",
    "JSON 格式：{\"translation\":\"中文译文\",\"grammarAnalysis\":\"语法解析，聚焦句子成分、结构层级和易错点\",\"terms\":[{\"term\":\"原文词/语法点\",\"note\":\"词性、搭配或语法功能\"}],\"readingTips\":[\"断句/跟读建议1\",\"断句/跟读建议2\"]}"
  ].join("\n");
}

function parseModelContent(content) {
  let value = String(content || "").trim();

  for (let attempts = 0; attempts < 3; attempts += 1) {
    const cleaned = stripModelFences(value);
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed === "string") {
        value = parsed;
        continue;
      }
      return parsed;
    } catch {
      value = cleaned;
      break;
    }
  }

  return {
    translation: "",
    grammarAnalysis: value || "模型未返回可解析内容。",
    terms: [],
    readingTips: []
  };
}

function stripModelFences(value) {
  return String(value || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function localAnalyze(payload) {
  const text = String(payload.text || "").trim();
  const sentences = text.split(/[.!?。！？]\s+/).filter(Boolean);
  const words = text.match(/[\p{L}']+/gu) || [];
  const keywords = Array.from(new Set(words.filter((word) => word.length > 6))).slice(0, 8);

  return {
    grammarAnalysis: [
      `当前选区约 ${words.length} 个词，${sentences.length || 1} 个句段。`,
      buildLocalGrammarSummary(text)
    ].join("\n"),
    terms: keywords.map((word) => ({ term: word, note: "长词或关键词，建议确认词性、搭配和句中功能" })),
    readingTips: [
      "先找谓语动词，再反推主语和宾语/表语。",
      "把介词短语、从句、插入语单独括出来。",
      "跟读时按主句、从句、修饰语分块停顿。"
    ]
  };
}

function buildLocalGrammarSummary(text) {
  const notes = [];

  if (/\b(which|that|who|where|when|whose)\b/i.test(text)) {
    notes.push("检测到英语关系词线索，注意关系从句的先行词和从句内部成分。");
  }
  if (/\b(if|because|since|although|while|when|as|para|si|porque|aunque|cuando)\b/i.test(text)) {
    notes.push("检测到从属连词线索，先分清主句与状语从句。");
  }
  if (/\b(is|are|was|were|be|been|ser|estar|es|son|fue|eran)\b/i.test(text)) {
    notes.push("检测到系动词/被动结构线索，注意表语、过去分词或补足语。");
  }
  if (/\b(of|de)\b/i.test(text)) {
    notes.push("检测到 of/de 名词后置限定结构，可从中心名词开始向后拆分。");
  }

  return notes.length
    ? notes.join("\n")
    : "本地模式会先提示基础拆句策略；接入模型后会给出完整句法层级解析。";
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function loadEnvFile(filePath, options = {}) {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    if (!options.overwrite && process.env[key] !== undefined) continue;
    if (options.overwrite && rawValue === "" && process.env[key]) continue;

    process.env[key] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  return value;
}

if (!process.env.VERCEL) {
  server.listen(port, () => {
    console.log(`Immersive reader running at http://127.0.0.1:${port}`);
  });
}
