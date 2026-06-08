import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
const DEFAULT_AI_MODEL = "gpt-5.5";

function logRuntimeError(message) {
  const logPath = path.join(app.getPath("userData"), "runtime-errors.log");
  fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

function getConfigPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf8");
}

function getApiKey() {
  return process.env.OPENAI_API_KEY || readSettings().openaiApiKey || "";
}

function getAiModel() {
  const settings = readSettings();
  return String(settings.aiModel || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL).trim() || DEFAULT_AI_MODEL;
}

function getAppLanguage() {
  const language = String(readSettings().appLanguage || "zh-Hant");
  return ["zh-Hant", "en"].includes(language) ? language : "zh-Hant";
}

function cleanModelText(text) {
  return String(text || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/([，。！？；：、,.!?;:])\1+/g, "$1")
    .replace(/([，。！？；：、])\s+([，。！？；：、])/g, "$2")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "Concept Vault",
    backgroundColor: "#f7f6f2",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL(devUrl);
  }

  mainWindow.webContents.on("did-fail-load", (_event, code, description, url) => {
    logRuntimeError(`did-fail-load ${code} ${description} ${url}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logRuntimeError(`render-process-gone ${JSON.stringify(details)}`);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("pick-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Documents", extensions: ["txt", "md", "csv", "tsv", "xlsx", "xls", "xlsm", "pdf", "docx"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle("open-external", async (_event, url) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "translate.google.com") {
    throw new Error("Only Google Translate links are allowed.");
  }
  await shell.openExternal(parsed.toString());
});

ipcMain.handle("ai-status", async () => ({
  model: getAiModel(),
  defaultModel: DEFAULT_AI_MODEL,
  appLanguage: getAppLanguage(),
  hasApiKey: Boolean(getApiKey())
}));

ipcMain.handle("save-openai-key", async (_event, apiKey) => {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) throw new Error("API key cannot be empty.");
  const settings = readSettings();
  settings.openaiApiKey = trimmed;
  writeSettings(settings);
  return { hasApiKey: true };
});

ipcMain.handle("save-app-settings", async (_event, payload) => {
  const settings = readSettings();
  const aiModel = String(payload?.aiModel || "").trim();
  const appLanguage = String(payload?.appLanguage || "zh-Hant");
  const apiKey = String(payload?.apiKey || "").trim();

  if (aiModel) settings.aiModel = aiModel;
  if (["zh-Hant", "en"].includes(appLanguage)) settings.appLanguage = appLanguage;
  if (apiKey) settings.openaiApiKey = apiKey;

  writeSettings(settings);
  return {
    model: getAiModel(),
    appLanguage: getAppLanguage(),
    hasApiKey: Boolean(getApiKey())
  };
});

ipcMain.handle("chat-gpt", async (_event, payload) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("請先設定 OPENAI_API_KEY，或在 app 內儲存 OpenAI API key。");
  }

  const question = String(payload?.question || "").trim();
  const context = String(payload?.context || "").trim();
  const images = Array.isArray(payload?.images) ? payload.images : [];
  const mode = payload?.mode === "general" ? "general" : "project";
  if (!question) throw new Error("請先輸入問題。");

  const client = new OpenAI({ apiKey });
  const aiModel = getAiModel();
  const input = mode === "project"
    ? [
        {
          role: "developer",
          content: [
            "You are the precise-answer engine for Concept Vault.",
            "Core rule: project database evidence comes first; general knowledge comes second.",
            "Answering rules:",
            "1. If the supplied context starts with DATABASE_MATCHES_FOUND, relevant project database excerpts were found. You must prioritize those excerpts.",
            "2. When database excerpts are found, begin with a section named 'Database evidence used' and list the actual Source and Locator used.",
            "3. If the user problem is not identical but uses the same concept, formula, definition, or solution method, solve it using the database method first.",
            "4. Do not ignore the database excerpts and switch to another method unless you explicitly explain why the excerpts are irrelevant or insufficient.",
            "5. If database excerpts are insufficient for the full answer, you may add general knowledge, but label it as 'Supplemental inference'.",
            "6. If the context starts with NO_DATABASE_MATCHES, you may answer from general knowledge, but first state 'No project database evidence found'.",
            "7. Never invent filenames, page numbers, slide numbers, or sources that are not present in the context.",
            "8. Use clean Markdown. Use LaTeX for formulas: inline $...$ and display $$...$$.",
            "9. Do not wrap the entire answer in a code block."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Question:
${question}

Project database context:
${context || "NO_DATABASE_MATCHES\nNo project database context was provided."}`
            },
            ...images.map((imageUrl) => ({
              type: "input_image",
              image_url: imageUrl
            }))
          ]
        }
      ]
    : [
        {
          role: "developer",
          content: "你是 Concept Vault 的 AI 助理。請清楚、準確地回答使用者問題。"
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: question },
            ...images.map((imageUrl) => ({
              type: "input_image",
              image_url: imageUrl
            }))
          ]
        }
      ];

  const response = await client.responses.create({
    model: aiModel,
    input
  });

  return {
    model: aiModel,
    output: cleanModelText(response.output_text)
  };
});

ipcMain.handle("translate-ai", async (_event, payload) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("請先設定 OPENAI_API_KEY，或在 app 內儲存 OpenAI API key。");
  }

  const text = String(payload?.text || "").trim();
  const sourceLang = String(payload?.sourceLang || "auto");
  const targetLang = String(payload?.targetLang || "zh-Hant");
  if (!text) throw new Error("請先輸入要翻譯的文字。");

  const client = new OpenAI({ apiKey });
  const aiModel = getAiModel();
  const response = await client.responses.create({
    model: aiModel,
    input: [
      {
        role: "developer",
        content: [
          "你是專業翻譯工具。",
          "只輸出翻譯結果，不要解釋，不要加前言。",
          "保留原文格式、換行、編號、公式與專有名詞。",
          "若原文是題目或教材內容，翻譯要自然且準確。"
        ].join("\n")
      },
      {
        role: "user",
        content: `來源語言：${sourceLang}\n目標語言：${targetLang}\n\n文字：\n${text}`
      }
    ]
  });

  return {
    model: aiModel,
    output: cleanModelText(response.output_text)
  };
});
