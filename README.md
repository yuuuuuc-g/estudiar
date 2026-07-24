# Reader

Monokai Classic 色系的沉浸式外语阅读原型，支持粘贴 Text / Markdown、预览、划取文本、中文译解、语法解析和浏览器语音朗读。

## 运行

```bash
npm run dev
```

打开 `http://127.0.0.1:3000`。

## Gemini 3.6 Flash

默认模型为 `gemini-3.6-flash`，接口使用 Gemini 原生 `generateContent` REST API。先在 `.env` 中填入：

```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.6-flash
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
PORT=3000
```

然后直接运行：

```bash
npm run dev
```

语法解析提示词会把全文 `fullText` 一并传给模型，但只允许用于消除指代或省略造成的语法歧义；模型会聚焦选区的句子成分、结构层级、从句、短语修饰、时态语态和易错点，不再分析选区在全文中的论证作用。西班牙语模式固定为 `es-MX`，提示词会要求关注墨西哥西语中的词序、性数一致、动词变位和介词搭配。

未设置 `GEMINI_API_KEY` 时会使用本地语法线索兜底，便于离线调试界面。

## Edge TTS

语音在部署环境优先通过 Azure Speech REST API 生成 MP3；未设置 Azure Speech 环境变量时，本地开发会回退到 `edge-tts` 命令。默认女声：

```env
AZURE_SPEECH_KEY=your-azure-speech-key
AZURE_SPEECH_REGION=eastus
EDGE_TTS_ES_MX_VOICE=es-MX-DaliaNeural
EDGE_TTS_EN_US_VOICE=en-US-JennyNeural
EDGE_TTS_COMMAND=edge-tts
```

选择 `Español · México` 时使用 `es-MX-DaliaNeural`；选择 `English · US` 时自动切换为 `en-US-JennyNeural`。

在 Vercel 上部署时，设置 `AZURE_SPEECH_KEY` 和 `AZURE_SPEECH_REGION` 即可保留后端 MP3 播放与导出功能；不要依赖 `EDGE_TTS_COMMAND`，因为 Vercel 运行时通常没有本机 `edge-tts` CLI。未配置 Azure Speech 时，线上播放会自动回退到浏览器内置朗读，但不能导出 MP3。
