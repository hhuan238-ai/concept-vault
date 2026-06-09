# Concept Vault

Concept Vault is a Windows desktop app for project-based document search, local concept matching, translation, and evidence-first question answering.

## Features

- Create independent projects, each with its own local document database.
- Upload TXT, Markdown, CSV, TSV, Excel, PDF, DOCX, and image files.
- Build a searchable local database with source tracking, including PDF page numbers when available.
- Ask questions in basic mode using local retrieval and template-style suggestions.
- Use precise answer mode with OpenAI for harder questions, while prioritizing project documents and matched concepts.
- Paste images or upload files into the question area.
- Generate downloadable Excel answer attachments when a question asks for an Excel or spreadsheet-style answer.
- Delete uploaded files and their related database chunks.
- Translate text locally, with optional OpenAI translation and a shortcut to Google Translate.

## Requirements

- Windows
- Node.js
- An OpenAI API key for precise answer mode and precise translation

## Development

```powershell
npm.cmd install
npm.cmd run electron
```

## Build A Windows App

```powershell
npm.cmd run build:app
```

The packaged app is created under:

```text
C:\myproject\concept-vault\release\Concept Vault-win32-x64\Concept Vault.exe
```

## OpenAI API Key

You can set the key in either place:

- In the app settings panel.
- As an environment variable named `OPENAI_API_KEY`.

The in-app key is stored locally in Electron user data, not in this repository.

## OpenAI Model

Precise answer mode and precise translation use `gpt-5.5` by default. You can change the default model from the settings button in the lower-right corner of the app.

You can also override it while launching the app by setting:

```powershell
$env:OPENAI_MODEL="gpt-5.4"
npm.cmd run electron
```

## Notes

- Project databases are stored locally by the app.
- Build outputs, local databases, shortcuts, logs, and environment files are ignored by git.
- Google Translate opens externally at `https://translate.google.com`.
