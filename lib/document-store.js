import fs from "node:fs";

const STORE_PATH = process.env.DOCUMENT_STORE_PATH || "/tmp/sindtapp-assinafy-documents.json";

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8") || "{}");
  } catch (error) {
    console.warn("Não foi possível ler o controle local de documentos:", error?.message);
    return {};
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.warn("Não foi possível salvar o controle local de documentos:", error?.message);
  }
}

export function saveDocumentMetadata(documentId, metadata) {
  if (!documentId) return;
  const key = String(documentId);
  const store = readStore();

  store[key] = {
    ...(store[key] || {}),
    ...(metadata || {}),
    documentId: key,
    updatedAt: new Date().toISOString(),
  };

  writeStore(store);

  globalThis.__assinafyDocumentRecipients = globalThis.__assinafyDocumentRecipients || new Map();
  globalThis.__assinafyDocumentRecipients.set(`assinafy:document:${key}`, store[key]);
}

export function getDocumentMetadata(documentId) {
  if (!documentId) return null;
  const key = String(documentId);

  globalThis.__assinafyDocumentRecipients = globalThis.__assinafyDocumentRecipients || new Map();
  const memoryValue = globalThis.__assinafyDocumentRecipients.get(`assinafy:document:${key}`);
  if (memoryValue) return memoryValue;

  const store = readStore();
  return store[key] || null;
}

export function markEmailSent(documentId, payload = {}) {
  const current = getDocumentMetadata(documentId) || {};
  saveDocumentMetadata(documentId, {
    ...current,
    ...payload,
    emailSent: true,
    emailSentAt: new Date().toISOString(),
  });
}
