const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("conceptVault", {
  pickFiles: () => ipcRenderer.invoke("pick-files"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  getAiStatus: () => ipcRenderer.invoke("ai-status"),
  saveOpenAiKey: (apiKey) => ipcRenderer.invoke("save-openai-key", apiKey),
  saveAppSettings: (payload) => ipcRenderer.invoke("save-app-settings", payload),
  chatGpt: (payload) => ipcRenderer.invoke("chat-gpt", payload),
  translateWithAi: (payload) => ipcRenderer.invoke("translate-ai", payload)
});
