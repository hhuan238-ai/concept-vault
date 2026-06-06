import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
const AI_MODEL = "gpt-5.2";

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
      { name: "Documents", extensions: ["txt", "md", "csv", "tsv", "pdf", "docx"] },
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
  model: AI_MODEL,
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
  const input = mode === "project"
    ? [
        {
          role: "developer",
          content: [
            "你是 Concept Vault 的 AI 學習助理。",
            "回答規則：",
            "1. 只要專案資料區塊包含任何相關片段，就必須優先且主要根據專案資料回答。",
            "2. 有相關專案資料時，不要用一般知識覆蓋資料庫中的解法、答案、定義或概念。",
            "3. 使用者貼上的題目不必和資料庫題目完全相同。只要它使用了資料庫裡相同或相近的概念、公式、模型、解題步驟，就必須套用資料庫的解題方式。",
            "4. 如果題目是選擇題、計算題或作業題，先判斷需要哪個概念或公式，再從專案資料中找相同概念、公式、解法或例題，最後用那個方法解新題。",
            "5. 如果專案資料可以推出答案，請直接給答案，然後用資料庫中的概念、公式或解題步驟簡短說明。",
            "6. 只有當專案資料明確寫著沒有找到相關片段時，才可以使用一般知識回答，並標註「補充：以下為一般知識」。",
            "7. 使用專案資料時，回答最後列出來源檔名與頁碼/位置。",
            "8. 不要編造來源，不要加入資料庫沒有支持的專有結論。",
            "9. 回答要自然、簡潔，不要使用多餘標點符號，不要大量堆疊項目符號。"
          ].join("\n")
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `問題：\n${question}\n\n專案資料：\n${context || "目前沒有檢索到專案資料。"}`
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
    model: AI_MODEL,
    input
  });

  return {
    model: AI_MODEL,
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
  const response = await client.responses.create({
    model: AI_MODEL,
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
    model: AI_MODEL,
    output: cleanModelText(response.output_text)
  };
});
