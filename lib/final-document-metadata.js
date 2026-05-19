export function appendFinalDocumentMetadataToFilename(filename, metadata = {}) {
  const safeFilename = normalizePdfFilename(filename || "ficha-sindtapp.pdf");
  const base = safeFilename.replace(/\.pdf$/i, "");
  const payload = {
    e: String(metadata.proponenteEmail || "").trim().toLowerCase(),
    n: String(metadata.proponenteName || "").trim(),
  };

  if (!payload.e && !payload.n) return safeFilename;

  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${base}__fdm_${token}__.pdf`;
}

export function extractFinalDocumentMetadataFromSources(...sources) {
  const candidates = [];

  for (const source of sources) {
    collectCandidateStrings(source, candidates);
  }

  for (const candidate of candidates) {
    const parsed = parseFinalDocumentMetadataToken(candidate);
    if (parsed.proponenteEmail || parsed.proponenteName) return parsed;
  }

  return {};
}

function parseFinalDocumentMetadataToken(value) {
  const match = String(value || "").match(/__fdm_([A-Za-z0-9_-]+)__/);
  if (!match) return {};

  try {
    const decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
    return {
      proponenteEmail: String(decoded?.e || "").trim().toLowerCase(),
      proponenteName: String(decoded?.n || "").trim(),
    };
  } catch {
    return {};
  }
}

function collectCandidateStrings(value, acc) {
  if (value == null) return;

  if (typeof value === "string" || typeof value === "number") {
    acc.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectCandidateStrings(item, acc));
    return;
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "name",
      "filename",
      "file_name",
      "originalFilename",
      "original_filename",
      "title",
      "documentName",
      "document_name",
      "path",
      "url",
    ];

    for (const key of preferredKeys) {
      if (value[key]) collectCandidateStrings(value[key], acc);
    }

    Object.values(value).forEach((item) => collectCandidateStrings(item, acc));
  }
}

function normalizePdfFilename(value) {
  const filename = String(value || "ficha-sindtapp.pdf")
    .trim()
    .replace(/[^a-zA-Z0-9À-ÿ._ -]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  return filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
}
