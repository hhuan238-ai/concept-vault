import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  ArrowLeft,
  BookOpen,
  Database,
  FilePlus2,
  FolderPlus,
  Image,
  Languages,
  MessageSquare,
  Paperclip,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload
} from "lucide-react";
import initSqlJs from "sql.js";
import * as mammoth from "mammoth/mammoth.browser";
import * as pdfjsLib from "pdfjs-dist";
import * as XLSX from "xlsx";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import "katex/dist/katex.min.css";
import "./styles.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

const DB_KEY = "concept-vault.sqlite";
const APP_LANGUAGES = [
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" }
];
const AI_MODEL_OPTIONS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini"
];
const SOURCE_LANGS = [
  { value: "auto", google: "auto", label: "自動偵測" },
  { value: "zh-Hant", google: "zh-TW", label: "繁體中文" },
  { value: "en", google: "en", label: "English" },
  { value: "ja", google: "ja", label: "日本語" },
  { value: "ko", google: "ko", label: "한국어" }
];

const TARGET_LANGS = [
  { value: "zh-Hant", google: "zh-TW", label: "繁體中文" },
  { value: "en", google: "en", label: "English" },
  { value: "ja", google: "ja", label: "日本語" },
  { value: "ko", google: "ko", label: "한국어" }
];

const glossary = {
  "zh-Hant": {
    project: "專案",
    evidence: "證據",
    answer: "答案",
    risk: "風險",
    cost: "成本",
    maintenance: "維護",
    recommendation: "建議",
    database: "資料庫",
    document: "文件",
    source: "來源",
    question: "問題",
    search: "搜尋",
    translation: "翻譯"
  },
  en: {
    專案: "project",
    證據: "evidence",
    答案: "answer",
    風險: "risk",
    成本: "cost",
    維護: "maintenance",
    建議: "recommendation",
    資料庫: "database",
    文件: "document",
    來源: "source",
    問題: "question",
    搜尋: "search",
    翻譯: "translation"
  }
};

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has", "are", "was", "were",
  "will", "would", "should", "could", "about", "into", "your", "you", "which", "what",
  "when", "where", "why", "how", "can", "all", "any", "each", "one", "two", "three",
  "a", "an", "of", "to", "in", "on", "at", "by", "as", "is", "it", "or", "if",
  "請", "問", "問題", "以下", "哪個", "什麼", "如何", "為何", "是否", "答案"
]);

const METHOD_TERMS = new Set([
  "formula", "equation", "method", "concept", "definition", "theorem", "model", "rule",
  "forecast", "forecasting", "error", "accuracy", "regression", "correlation", "probability",
  "distribution", "sample", "mean", "median", "variance", "standard", "deviation",
  "npv", "irr", "revenue", "cost", "profit", "demand", "supply", "inventory",
  "公式", "方程式", "方法", "概念", "定義", "模型", "規則", "預測", "誤差", "準確度",
  "迴歸", "相關", "機率", "分配", "平均", "變異", "標準差", "成本", "收益", "利潤"
]);

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function saveDatabase(db) {
  localStorage.setItem(DB_KEY, bytesToBase64(db.export()));
}

function execScalar(db, sql, params = []) {
  if (!db) return null;
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}

function queryRows(db, sql, params = []) {
  if (!db) return [];
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function tokenize(text) {
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu);
  return [...new Set(words || [])]
    .filter((word) => !STOP_WORDS.has(word))
    .slice(0, 45);
}

function extractPhrases(text) {
  return String(text)
    .replace(/\s+/g, " ")
    .split(/[。！？!?;；\n]/)
    .map((phrase) => phrase.trim().toLowerCase())
    .filter((phrase) => phrase.length >= 12 && phrase.length <= 120)
    .slice(0, 8);
}

function scoreChunk(body, terms, rawQuestion = "") {
  const normalized = body.toLowerCase();
  const termScore = terms.reduce((score, term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = normalized.match(new RegExp(escaped, "g"));
    const count = matches?.length || 0;
    if (!count) return score;
    const weight = /^\d+(\.\d+)?$/.test(term)
      ? 8
      : METHOD_TERMS.has(term)
        ? 7
        : term.length >= 7
          ? 4
          : term.length >= 4
            ? 2
            : 1;
    return score + count * weight;
  }, 0);

  const phraseScore = extractPhrases(rawQuestion).reduce((score, phrase) => {
    return normalized.includes(phrase) ? score + 20 : score;
  }, 0);

  return termScore + phraseScore;
}

function chunkText(text, locatorPrefix = "段落") {
  const normalized = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if ((current + "\n\n" + paragraph).length > 900 && current.length > 160) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.flatMap((chunk, chunkIndex) => {
    const locator = locatorPrefix.startsWith("PDF")
      ? `${locatorPrefix}${chunks.length > 1 ? ` / 片段 ${chunkIndex + 1}` : ""}`
      : `${locatorPrefix} ${chunkIndex + 1}`;
    if (chunk.length <= 1200) return [{ body: chunk, locator }];
    const parts = [];
    for (let i = 0; i < chunk.length; i += 900) {
      parts.push({ body: chunk.slice(i, i + 900), locator: `${locator} / 片段 ${Math.floor(i / 900) + 1}` });
    }
    return parts;
  });
}

async function extractText(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (["txt", "md", "csv", "tsv"].includes(ext)) {
    return chunkText(await file.text(), "段落");
  }

  const buffer = await file.arrayBuffer();
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return chunkText(result.value, "段落");
  }

  if (["xlsx", "xls", "xlsm"].includes(ext)) {
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const chunks = [];
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(worksheet, { blankrows: false });
      const text = csv.trim();
      if (text) chunks.push(...chunkText(text, `Excel 工作表 ${sheetName}`));
    }
    return chunks;
  }

  if (ext === "pdf") {
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const chunks = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");
      chunks.push(...chunkText(pageText, `PDF 第 ${pageNo} 頁`));
    }
    return chunks;
  }

  throw new Error(`不支援的檔案格式：${ext || "unknown"}`);
}

function createSchema(db) {
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      body TEXT NOT NULL,
      position INTEGER NOT NULL,
      source_locator TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id),
      FOREIGN KEY (file_id) REFERENCES files(id)
    );
    CREATE TABLE IF NOT EXISTS translations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      translated_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const translationColumns = queryRows(db, "PRAGMA table_info(translations)").map((row) => row.name);
  if (!translationColumns.includes("project_id")) {
    db.run("ALTER TABLE translations ADD COLUMN project_id TEXT NOT NULL DEFAULT ''");
  }

  const chunkColumns = queryRows(db, "PRAGMA table_info(chunks)").map((row) => row.name);
  if (!chunkColumns.includes("source_locator")) {
    db.run("ALTER TABLE chunks ADD COLUMN source_locator TEXT NOT NULL DEFAULT ''");
  }
}

function translateText(text, sourceLang, targetLang) {
  const dictionary = glossary[targetLang] || {};
  let translated = text;
  for (const [from, to] of Object.entries(dictionary)) {
    translated = translated.replaceAll(from, to);
  }

  if (translated === text) {
    const sourceLabel = SOURCE_LANGS.find((lang) => lang.value === sourceLang)?.label || sourceLang;
    const targetLabel = TARGET_LANGS.find((lang) => lang.value === targetLang)?.label || targetLang;
    return `本地詞庫目前沒有足夠詞條可完整翻譯。\n來源：${sourceLabel}\n目標：${targetLabel}\n\n${text}`;
  }
  return translated;
}

function FormattedOutput({ value, mode = "markdown", fallback }) {
  const content = value || fallback;

  if (mode === "plain") {
    return <pre>{content}</pre>;
  }

  return (
    <div className="markdown-answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function AnswerContent({ value, mode }) {
  const fallback = mode === "basic"
    ? "Search results will appear here."
    : "Precise answer will appear here.";

  return (
    <FormattedOutput
      value={value}
      mode="markdown"
      fallback={fallback}
    />
  );
}
function inferSlideNumber(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const trailingNumber = normalized.match(/(?:^|[\s;:])(\d{1,4})$/);
  if (trailingNumber) return trailingNumber[1];

  const pageLike = normalized.match(/(?:page|slide|投影片|頁碼)\s*(\d{1,4})/i);
  return pageLike?.[1] || "";
}

function formatSourceLocator(match) {
  const explicitLocator = String(match.source_locator || "").trim();
  const inferredSlide = inferSlideNumber(match.body || "");

  if (explicitLocator && inferredSlide && !explicitLocator.includes(inferredSlide)) {
    return `${explicitLocator}；投影片/頁碼 ${inferredSlide}（由片段文字推測）`;
  }

  if (explicitLocator) return explicitLocator;

  if (String(match.file_name || "").toLowerCase().endsWith(".pdf") && inferredSlide) {
    return `投影片/頁碼 ${inferredSlide}（由片段文字推測；舊資料未保存 PDF 實際頁碼）`;
  }

  return "來源位置未保存；重新匯入 PDF 後可顯示實際頁碼";
}

function buildSuggestion(question, matches) {
  if (!matches.length) {
    return "目前此專案資料庫沒有找到足夠相符的片段。建議換一組關鍵詞，或先上傳更多相關文件。";
  }

  const keywords = tokenize(question);
  const strongest = matches[0];
  const sharedTerms = keywords.filter((term) => strongest.body.toLowerCase().includes(term));
  const basis = sharedTerms.length
    ? `命中的主要詞彙包含：${sharedTerms.join("、")}。`
    : "系統依本專案資料庫的關鍵詞相符度排序。";
  const excerpt = strongest.body.length > 900 ? `${strongest.body.slice(0, 900)}...` : strongest.body;
  const sourceLocator = formatSourceLocator(strongest);

  return [
    `最相符來源：${strongest.file_name}，${sourceLocator}。`,
    `相符分數：${Number(strongest.score || 0).toFixed(2)}。`,
    basis,
    "",
    "最相關擷取內容：",
    excerpt,
    "",
    `建議先根據上方擷取內容回答「${question}」。`,
    "此建議由檢索分數與固定模板產生，不使用生成式 AI 自由撰寫。"
  ].join("\n");
}

function App() {
  const [db, setDb] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [files, setFiles] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [projectName, setProjectName] = useState("");
  const [question, setQuestion] = useState("");
  const [questionAttachments, setQuestionAttachments] = useState([]);
  const [results, setResults] = useState([]);
  const [suggestion, setSuggestion] = useState("");
  const [status, setStatus] = useState("正在初始化資料庫...");
  const [isBusy, setIsBusy] = useState(false);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("zh-Hant");
  const [translationInput, setTranslationInput] = useState("");
  const [translationOutput, setTranslationOutput] = useState("");
  const [translationBusy, setTranslationBusy] = useState(false);
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiHasKey, setAiHasKey] = useState(false);
  const [questionMode, setQuestionMode] = useState("basic");
  const [aiBusy, setAiBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appLanguage, setAppLanguage] = useState("zh-Hant");
  const [aiModel, setAiModel] = useState("gpt-5.5");
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);

  const activeProject = useMemo(
    () => projects.find((project) => project.id === activeProjectId),
    [projects, activeProjectId]
  );

  const stats = {
    projectCount: projects.length,
    fileCount: files.length,
    chunkCount: execScalar(db, "SELECT COUNT(*) AS total FROM chunks WHERE project_id = ?", [activeProjectId])?.total || 0
  };

  useEffect(() => {
    let mounted = true;
    initSqlJs({ locateFile: () => sqlWasmUrl })
      .then((SQL) => {
        const saved = localStorage.getItem(DB_KEY);
        const database = saved ? new SQL.Database(base64ToBytes(saved)) : new SQL.Database();
        createSchema(database);
        if (!mounted) return;
        setDb(database);
        refresh(database, "");
        setStatus("資料庫已就緒。請先建立或選擇一個專案。");
      })
      .catch((error) => {
        setStatus(`資料庫初始化失敗：${error.message}`);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    window.conceptVault?.getAiStatus?.().then((info) => {
      setAiHasKey(Boolean(info?.hasApiKey));
      if (info?.model) setAiModel(info.model);
      if (info?.appLanguage) setAppLanguage(info.appLanguage);
    });
  }, []);

  function refresh(database = db, projectId = activeProjectId) {
    if (!database) return;
    const nextProjects = queryRows(database, "SELECT * FROM projects ORDER BY created_at DESC");
    setProjects(nextProjects);
    setActiveProjectId(projectId);

    if (projectId) {
      setFiles(queryRows(database, "SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC", [projectId]));
      setChunks(queryRows(database, "SELECT * FROM chunks WHERE project_id = ? ORDER BY created_at DESC LIMIT 120", [projectId]));
    } else {
      setFiles([]);
      setChunks([]);
      setResults([]);
      setSuggestion("");
      setQuestion("");
      setQuestionAttachments([]);
      setTranslationInput("");
      setTranslationOutput("");
    }
  }

  async function createProject() {
    const name = projectName.trim();
    if (!db) {
      setStatus("資料庫尚未初始化完成，請稍等。");
      return;
    }
    if (!name) {
      setStatus("請先輸入專案名稱，再按新增。");
      return;
    }

    const id = uuid();
    db.run("INSERT INTO projects VALUES (?, ?, ?)", [id, name, nowIso()]);
    await saveDatabase(db);
    setProjectName("");
    refresh(db, "");
    setStatus(`已新增專案「${name}」。請在左側點擊專案進入後再建立資料庫。`);
  }

  function enterProject(projectId) {
    refresh(db, projectId);
    const project = projects.find((item) => item.id === projectId);
    setStatus(`已進入專案「${project?.name || ""}」。此專案有獨立的檔案與資料庫片段。`);
  }

  async function importFiles(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    if (!db || !activeProjectId) {
      setStatus("請先點擊左側專案進入，才能建立該專案的資料庫。");
      return;
    }
    if (!selected.length) {
      setStatus("沒有選擇檔案。");
      return;
    }

    setIsBusy(true);
    setStatus(`正在匯入 ${selected.length} 個檔案...`);
    try {
      let importedChunks = 0;
      for (const file of selected) {
        const fileId = uuid();
        const parts = await extractText(file);
        if (!parts.length) continue;

        db.run("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)", [
          fileId,
          activeProjectId,
          file.name,
          file.type || file.name.split(".").pop() || "file",
          file.size,
          nowIso()
        ]);

        parts.forEach((part, index) => {
          db.run(
            `INSERT INTO chunks
             (id, project_id, file_id, body, position, source_locator, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
            uuid(),
            activeProjectId,
            fileId,
            part.body,
            index + 1,
            part.locator,
            nowIso()
            ]
          );
        });
        importedChunks += parts.length;
      }

      await saveDatabase(db);
      refresh(db, activeProjectId);
      setStatus(`已匯入 ${selected.length} 個檔案，為此專案建立 ${importedChunks} 個資料片段。`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function deleteFile(fileId, fileName) {
    if (!db || !activeProjectId) return;
    const ok = window.confirm(`確定要從此專案資料庫刪除「${fileName}」嗎？相關片段也會一起刪除。`);
    if (!ok) return;

    db.run("DELETE FROM chunks WHERE project_id = ? AND file_id = ?", [activeProjectId, fileId]);
    db.run("DELETE FROM files WHERE project_id = ? AND id = ?", [activeProjectId, fileId]);
    await saveDatabase(db);
    setResults([]);
    setSuggestion("");
    refresh(db, activeProjectId);
    setStatus(`已刪除「${fileName}」與其資料庫片段。`);
  }

  function questionWithAttachments() {
    const attachmentText = questionAttachments
      .filter((attachment) => attachment.text)
      .map((attachment) => `\n\n[附件：${attachment.name}]\n${attachment.text}`)
      .join("");
    return `${question.trim()}${attachmentText}`.trim();
  }

  async function answerQuestion() {
    const fullQuestion = questionWithAttachments();
    if (!db || !activeProjectId) {
      setStatus("請先進入一個專案。");
      return;
    }
    if (!fullQuestion && !questionAttachments.length) {
      setStatus("請先輸入問題或加入附件。");
      return;
    }
    if (questionMode === "basic" && !fullQuestion) {
      setStatus("基本模式需要文字問題或可抽取文字的附件；圖片請使用精確回答。");
      return;
    }

    if (questionMode === "precise") {
      await askGpt();
      return;
    }

    const terms = tokenize(fullQuestion);
    const allChunks = queryRows(
      db,
      `SELECT c.id AS chunk_id, f.name AS file_name, c.body, c.source_locator
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE c.project_id = ?`,
      [activeProjectId]
    );

    const matches = allChunks
      .map((chunk) => ({ ...chunk, score: scoreChunk(chunk.body, terms, fullQuestion) }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score || b.body.length - a.body.length)
      .slice(0, 8);

    setResults(matches);
    setSuggestion(buildSuggestion(fullQuestion, matches));
    setStatus(matches.length ? `在此專案找到 ${matches.length} 個相符片段。` : "此專案沒有找到相符片段。");
  }

  function toggleQuestionModeShortcut() {
    setQuestionMode((current) => {
      const next = current === "basic" ? "precise" : "basic";
      setStatus(next === "precise" ? "已切換為精確回答。" : "已切換為基本模式。");
      return next;
    });
  }

  function findProjectMatches(rawQuestion, limit = 5) {
    const terms = tokenize(rawQuestion);
    const allChunks = queryRows(
      db,
      `SELECT c.id AS chunk_id, f.name AS file_name, c.body, c.source_locator
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE c.project_id = ?`,
      [activeProjectId]
    );

    return allChunks
      .map((chunk) => ({ ...chunk, score: scoreChunk(chunk.body, terms, rawQuestion) }))
      .filter((chunk) => chunk.score >= 2)
      .sort((a, b) => b.score - a.score || b.body.length - a.body.length)
      .slice(0, limit);
  }

  function buildAiContext(matches) {
    if (!matches.length) {
      return [
        "NO_DATABASE_MATCHES",
        "No sufficiently relevant project database excerpts were found. The model may answer from general knowledge, but it must clearly say the answer is not based on project database evidence."
      ].join("\n");
    }

    const evidence = matches.map((match, index) => {
      const locator = formatSourceLocator(match);
      const excerpt = match.body.length > 1800 ? `${match.body.slice(0, 1800)}...` : match.body;
      return [
        `[${index + 1}] Source: ${match.file_name}`,
        `Locator: ${locator}`,
        `Match score: ${Number(match.score || 0).toFixed(2)}`,
        "Excerpt:",
        excerpt
      ].join("\n");
    }).join("\n\n");

    return [
      "DATABASE_MATCHES_FOUND",
      "The excerpts below are the strongest matches from this project database. The answer must prioritize these excerpts.",
      "If the problem is not identical but uses the same concept, formula, definition, or solution method, use the database method first.",
      "Do not replace these excerpts with general knowledge unless they are clearly irrelevant or insufficient.",
      "",
      evidence
    ].join("\n");
  }

  async function saveApiKey() {
    if (!aiApiKey.trim()) {
      setStatus("請先輸入 OpenAI API key。");
      return;
    }

    try {
      await window.conceptVault?.saveOpenAiKey(aiApiKey.trim());
      setAiApiKey("");
      setAiHasKey(true);
      setStatus("OpenAI API key 已儲存在本機設定。");
    } catch (error) {
      setStatus(`API key 儲存失敗：${error.message}`);
    }
  }

  async function saveAppSettings() {
    setSettingsBusy(true);
    try {
      const info = await window.conceptVault?.saveAppSettings?.({
        appLanguage,
        aiModel,
        apiKey: settingsApiKey.trim()
      });
      if (info?.model) setAiModel(info.model);
      if (info?.appLanguage) setAppLanguage(info.appLanguage);
      setAiHasKey(Boolean(info?.hasApiKey));
      setSettingsApiKey("");
      setSettingsOpen(false);
      setStatus(appLanguage === "en" ? "Settings saved." : "設定已儲存。");
    } catch (error) {
      setStatus(`${appLanguage === "en" ? "Settings failed" : "設定儲存失敗"}：${error.message}`);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function askGpt() {
    const fullQuestion = questionWithAttachments();
    const images = questionAttachments
      .filter((attachment) => attachment.kind === "image" && attachment.dataUrl)
      .map((attachment) => attachment.dataUrl);

    if (!fullQuestion && !images.length) {
      setStatus("請先輸入問題、貼上圖片或加入附件。");
      return;
    }
    if (!activeProjectId) {
      setStatus("精確模式需要先進入專案。");
      return;
    }

    setAiBusy(true);
    setSuggestion("");
    try {
      const matches = fullQuestion ? findProjectMatches(fullQuestion, 14) : [];
      const result = await window.conceptVault?.chatGpt({
        mode: "project",
        question: fullQuestion || "請根據附件圖片回答問題。",
        context: buildAiContext(matches),
        images
      });
      setResults(matches);
      setSuggestion(result?.output || "沒有收到精確回答。");
      setStatus(matches.length ? "精確回答已完成，並已參考專案資料。" : "精確回答已完成；資料庫沒有相關片段，已改用一般知識。");
    } catch (error) {
      setStatus(`精確回答失敗：${error.message}`);
    } finally {
      setAiBusy(false);
    }
  }

  async function addQuestionFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;

    setStatus(`正在讀取 ${selected.length} 個提問附件...`);
    const nextAttachments = [];

    for (const file of selected) {
      try {
        if (file.type.startsWith("image/")) {
          nextAttachments.push({
            id: uuid(),
            name: file.name || "貼上的圖片",
            type: file.type,
            kind: "image",
            dataUrl: await fileToDataUrl(file),
            text: ""
          });
        } else {
          const parts = await extractText(file);
          nextAttachments.push({
            id: uuid(),
            name: file.name,
            type: file.type || file.name.split(".").pop() || "file",
            kind: "text",
            text: parts.map((part) => part.body).join("\n\n"),
            dataUrl: ""
          });
        }
      } catch (error) {
        nextAttachments.push({
          id: uuid(),
          name: file.name || "附件",
          type: file.type || "file",
          kind: "error",
          text: `無法讀取附件：${error.message}`,
          dataUrl: ""
        });
      }
    }

    setQuestionAttachments((current) => [...current, ...nextAttachments]);
    setStatus("提問附件已加入。");
  }

  function removeQuestionAttachment(id) {
    setQuestionAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  function handleQuestionPaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length) {
      event.preventDefault();
      addQuestionFiles(imageFiles);
    }
  }

  async function runTranslation() {
    if (!db || !activeProjectId) {
      setStatus("請先進入一個專案。");
      return;
    }
    if (!translationInput.trim()) {
      setStatus("請先輸入要翻譯的文字。");
      return;
    }

    const translated = translateText(translationInput.trim(), sourceLang, targetLang);
    setTranslationOutput(translated);
    db.run(
      `INSERT INTO translations
       (id, project_id, source_text, target_lang, translated_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        activeProjectId,
        translationInput.trim(),
        targetLang,
        translated,
        nowIso()
      ]
    );
    await saveDatabase(db);
    setStatus("翻譯已完成，並存在目前專案。");
  }

  async function runPreciseTranslation() {
    if (!translationInput.trim()) {
      setStatus("請先輸入要翻譯的文字。");
      return;
    }

    setTranslationBusy(true);
    try {
      const result = await window.conceptVault?.translateWithAi({
        text: translationInput.trim(),
        sourceLang,
        targetLang
      });
      const translated = result?.output || "";
      setTranslationOutput(translated || "沒有收到精確翻譯結果。");

      if (db && activeProjectId && translated) {
        db.run(
          `INSERT INTO translations
           (id, project_id, source_text, target_lang, translated_text, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            uuid(),
            activeProjectId,
            translationInput.trim(),
            targetLang,
            translated,
            nowIso()
          ]
        );
        await saveDatabase(db);
      }
      setStatus("精確翻譯已完成。");
    } catch (error) {
      setStatus(`精確翻譯失敗：${error.message}`);
    } finally {
      setTranslationBusy(false);
    }
  }

  function swapTranslationLanguages() {
    if (sourceLang === "auto") {
      setSourceLang(targetLang);
      setTargetLang("en");
      return;
    }
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setTranslationInput(translationOutput || translationInput);
    setTranslationOutput("");
  }

  function clearTranslation() {
    setTranslationInput("");
    setTranslationOutput("");
  }

  async function copyTranslationOutput() {
    if (!translationOutput.trim()) {
      setStatus("目前沒有翻譯結果可複製。");
      return;
    }
    await navigator.clipboard.writeText(translationOutput);
    setStatus("翻譯結果已複製。");
  }

  function useQuestionForTranslation() {
    const text = questionWithAttachments();
    if (!text) {
      setStatus("目前沒有提問文字可帶入翻譯。");
      return;
    }
    setTranslationInput(text);
    setStatus("已將目前提問帶入翻譯。");
  }

  function useAnswerForTranslation() {
    if (!suggestion.trim()) {
      setStatus("目前沒有回答內容可帶入翻譯。");
      return;
    }
    setTranslationInput(suggestion);
    setStatus("已將目前回答帶入翻譯。");
  }

  async function openGoogleTranslate() {
    if (!translationInput.trim()) {
      setStatus("請先輸入要送到 Google 翻譯的文字。");
      return;
    }

    const source = SOURCE_LANGS.find((lang) => lang.value === sourceLang)?.google || "auto";
    const target = TARGET_LANGS.find((lang) => lang.value === targetLang)?.google || "zh-TW";
    const url = new URL("https://translate.google.com/");
    url.searchParams.set("sl", source);
    url.searchParams.set("tl", target);
    url.searchParams.set("text", translationInput.trim());
    url.searchParams.set("op", "translate");

    try {
      await window.conceptVault?.openExternal(url.toString());
      setStatus("已在瀏覽器開啟 Google 翻譯。");
    } catch (error) {
      setStatus(`無法開啟 Google 翻譯：${error.message}`);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Database size={24} />
          <div>
            <strong>Concept Vault</strong>
            <span>本地概念查找</span>
          </div>
        </div>

        <section className="create-project">
          <label htmlFor="project-name">新增專案</label>
          <div className="inline-form">
            <input
              id="project-name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && createProject()}
              placeholder="例如：期末資料庫"
            />
            <button type="button" className="create-button" onClick={createProject} title="新增專案">
              <FolderPlus size={18} />
              <span>新增</span>
            </button>
          </div>
        </section>

        <nav className="project-list" aria-label="Projects">
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              className={project.id === activeProjectId ? "active" : ""}
              onClick={() => enterProject(project.id)}
            >
              <BookOpen size={17} />
              <span>{project.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{activeProject?.name || "先建立或選擇專案"}</h1>
            <p>{status}</p>
          </div>
          <div className="stats">
            <span>{stats.projectCount} 專案</span>
            <span>{stats.fileCount} 檔案</span>
            <span>{stats.chunkCount} 片段</span>
          </div>
        </header>

        {!activeProject ? (
          <section className="empty-state">
            <BookOpen size={42} />
            <h2>請先建立專案，再點擊左側專案進入</h2>
            <p>每個專案都有自己的檔案、資料片段、搜尋結果與翻譯紀錄。進入專案後才能上傳檔案建立資料庫。</p>
          </section>
        ) : (
          <>
            <button type="button" className="back-button" onClick={() => refresh(db, "")}>
              <ArrowLeft size={17} />
              回到專案列表
            </button>

            <div className="main-grid">
              <section className="panel upload-panel">
                <div className="panel-title">
                  <Upload size={19} />
                  <h2>建立此專案的資料庫</h2>
                </div>
                <label className={`upload-zone ${isBusy ? "disabled" : ""}`}>
                  <FilePlus2 size={28} />
                  <span>{isBusy ? "正在建立資料庫..." : "點此上傳 TXT、Markdown、CSV、PDF 或 DOCX"}</span>
                  <input
                    type="file"
                    multiple
                    accept=".txt,.md,.csv,.tsv,.xlsx,.xls,.xlsm,.pdf,.docx"
                    disabled={isBusy}
                    onChange={importFiles}
                  />
                </label>

                <div className="file-list">
                  {files.map((file) => (
                    <article key={file.id}>
                      <div>
                        <strong>{file.name}</strong>
                        <span>{Math.max(1, Math.round(file.size / 1024))} KB</span>
                      </div>
                      <button
                        type="button"
                        className="danger-icon"
                        onClick={() => deleteFile(file.id, file.name)}
                        title="刪除此檔案與資料庫片段"
                      >
                        <Trash2 size={17} />
                      </button>
                    </article>
                  ))}
                  {!files.length && (
                    <p className="muted-note">此專案尚未上傳資料。上傳後可在這裡刪除資料庫中的檔案與片段。</p>
                  )}
                </div>
              </section>

              <section className="panel search-panel">
                <div className="panel-title">
                  <button
                    type="button"
                    className="title-icon-button"
                    onDoubleClick={toggleQuestionModeShortcut}
                    title="雙擊切換基本模式 / 精確回答"
                  >
                    <Search size={19} />
                  </button>
                  <h2>在此專案提問</h2>
                  <span className="mode-badge">{questionMode === "basic" ? "基本模式" : "精確回答"}</span>
                </div>
                {questionMode === "precise" && !aiHasKey && (
                  <div className="api-key-row">
                    <input
                      type="password"
                      value={aiApiKey}
                      onChange={(event) => setAiApiKey(event.target.value)}
                      placeholder="輸入 OpenAI API key"
                    />
                    <button type="button" onClick={saveApiKey}>儲存</button>
                  </div>
                )}
                <textarea
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onPaste={handleQuestionPaste}
                  placeholder={questionMode === "basic"
                    ? "輸入問題，例如：哪個方案成本最低且維護風險較小？"
                    : "輸入問題，系統會依此專案資料與來源精確回答"}
                />
                <div className="question-tools">
                  <label className="attachment-button">
                    <Paperclip size={17} />
                    加入附件
                    <input
                      type="file"
                      multiple
                      accept=".txt,.md,.csv,.tsv,.xlsx,.xls,.xlsm,.pdf,.docx,image/*"
                      onChange={(event) => {
                        addQuestionFiles(event.target.files);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <span>可上傳 PDF/DOCX/TXT/圖片，也可直接貼上圖片。</span>
                </div>
                {!!questionAttachments.length && (
                  <div className="attachment-list">
                    {questionAttachments.map((attachment) => (
                      <article key={attachment.id}>
                        {attachment.kind === "image" ? <Image size={16} /> : <Paperclip size={16} />}
                        <div>
                          <strong>{attachment.name}</strong>
                          <span>
                            {attachment.kind === "image"
                              ? "圖片附件，精確回答會一併參考"
                              : attachment.kind === "error"
                                ? attachment.text
                                : "文字附件，基本模式與精確回答都會參考"}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="danger-icon small"
                          onClick={() => removeQuestionAttachment(attachment.id)}
                          title="移除此提問附件"
                        >
                          <Trash2 size={15} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className="primary"
                  onClick={answerQuestion}
                  disabled={(!question.trim() && !questionAttachments.length) || aiBusy}
                >
                  {questionMode === "basic" ? <Search size={18} /> : <MessageSquare size={18} />}
                  {questionMode === "basic"
                    ? "搜尋此專案資料"
                    : aiBusy ? "精確回答中..." : "精確回答"}
                </button>

                <div className="suggestion">
                  <div className="panel-title small">
                    <Sparkles size={17} />
                    <h3>{questionMode === "basic" ? "模板式建議" : "精確回答"}</h3>
                  </div>
                  <AnswerContent value={suggestion} mode={questionMode} />
                </div>
              </section>

              <section className="panel translation-panel">
                <div className="panel-title">
                  <Languages size={19} />
                  <h2>此專案翻譯</h2>
                </div>
                <div className="translate-controls">
                  <select value={sourceLang} onChange={(event) => setSourceLang(event.target.value)}>
                    {SOURCE_LANGS.map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={swapTranslationLanguages}>
                    交換
                  </button>
                  <select value={targetLang} onChange={(event) => setTargetLang(event.target.value)}>
                    {TARGET_LANGS.map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                  </select>
                </div>
                <div className="translation-actions">
                  <button type="button" onClick={runTranslation} disabled={!translationInput.trim()}>
                    <Languages size={17} />
                    本地翻譯
                  </button>
                  <button type="button" onClick={runPreciseTranslation} disabled={!translationInput.trim() || translationBusy}>
                    <Languages size={17} />
                    {translationBusy ? "精確翻譯中..." : "精確翻譯"}
                  </button>
                  <button type="button" onClick={openGoogleTranslate} disabled={!translationInput.trim()}>
                    <Languages size={17} />
                    Google
                  </button>
                </div>
                <div className="translation-tools">
                  <button type="button" onClick={useQuestionForTranslation}>帶入提問</button>
                  <button type="button" onClick={useAnswerForTranslation}>帶入回答</button>
                  <button type="button" onClick={copyTranslationOutput}>複製結果</button>
                  <button type="button" onClick={clearTranslation}>清空</button>
                </div>
                <textarea
                  className="translation-input"
                  value={translationInput}
                  onChange={(event) => setTranslationInput(event.target.value)}
                  placeholder="輸入要翻譯的詞句，或使用上方按鈕帶入目前提問/回答。"
                />
                <FormattedOutput value={translationOutput} fallback="Translation output will appear here." />
              </section>

            </div>
          </>
        )}
      </section>
      <button
        type="button"
        className="floating-settings-button"
        onClick={() => setSettingsOpen(true)}
        title={appLanguage === "en" ? "Settings" : "設定"}
        aria-label={appLanguage === "en" ? "Settings" : "設定"}
      >
        <Settings size={22} />
      </button>

      {settingsOpen && (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label={appLanguage === "en" ? "Settings" : "設定"}>
          <section className="settings-panel">
            <div className="settings-header">
              <div>
                <h2>{appLanguage === "en" ? "Settings" : "設定"}</h2>
                <p>{appLanguage === "en" ? "Adjust language, default model, and API key." : "調整語言、預設模型與 API key。"}</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label={appLanguage === "en" ? "Close" : "關閉"}>
                ×
              </button>
            </div>

            <label className="settings-field">
              <span>{appLanguage === "en" ? "Language" : "語言"}</span>
              <select value={appLanguage} onChange={(event) => setAppLanguage(event.target.value)}>
                {APP_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>{language.label}</option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>{appLanguage === "en" ? "Default model" : "預設模型"}</span>
              <select value={aiModel} onChange={(event) => setAiModel(event.target.value)}>
                {AI_MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span>{appLanguage === "en" ? "OpenAI API key" : "OpenAI API key"}</span>
              <input
                type="password"
                value={settingsApiKey}
                onChange={(event) => setSettingsApiKey(event.target.value)}
                placeholder={aiHasKey
                  ? (appLanguage === "en" ? "Saved. Enter a new key to replace it." : "已儲存。輸入新 key 可覆蓋。")
                  : (appLanguage === "en" ? "Enter your API key" : "輸入你的 API key")}
              />
            </label>

            <div className="settings-meta">
              <span>{appLanguage === "en" ? "Current model" : "目前模型"}：{aiModel}</span>
              <span>{aiHasKey ? (appLanguage === "en" ? "API key saved" : "API key 已儲存") : (appLanguage === "en" ? "No API key" : "尚未儲存 API key")}</span>
            </div>

            <div className="settings-actions">
              <button type="button" className="secondary-action" onClick={() => setSettingsOpen(false)}>
                {appLanguage === "en" ? "Cancel" : "取消"}
              </button>
              <button type="button" className="primary" onClick={saveAppSettings} disabled={settingsBusy}>
                {settingsBusy ? (appLanguage === "en" ? "Saving..." : "儲存中...") : (appLanguage === "en" ? "Save settings" : "儲存設定")}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
