export function getAssinafyHeaders(apiKeyOverride = "") {
  const apiKey = apiKeyOverride || process.env.ASSINAFY_API_KEY;
  const accessToken = process.env.ASSINAFY_ACCESS_TOKEN;
  const headers = {};

  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (apiKey) headers["X-Api-Key"] = apiKey;

  if (!apiKey && !accessToken) {
    throw new Error("Configure ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN nas variáveis de ambiente.");
  }

  return headers;
}

export function getAssinafyBaseUrl() {
  return process.env.ASSINAFY_BASE_URL || "https://api.assinafy.com.br/v1";
}

export function extractDocumentId(body = {}) {
  return (
    body?.object?.id ||
    body?.payload?.object?.id ||
    body?.payload?.document?.id ||
    body?.data?.document?.id ||
    body?.data?.id ||
    body?.document?.id ||
    body?.document_id ||
    body?.id_document ||
    body?.id ||
    ""
  );
}

export function extractMetadata(source) {
  if (!source) return {};

  const possible =
    source.metadata ||
    source.custom_data ||
    source.customData ||
    source.data?.metadata ||
    source.data?.custom_data ||
    source.data?.customData ||
    source.object?.metadata ||
    source.object?.custom_data ||
    source.object?.customData ||
    source.payload?.metadata ||
    source.payload?.custom_data ||
    source.payload?.customData ||
    {};

  if (typeof possible === "string") {
    try {
      return JSON.parse(possible);
    } catch {
      return {};
    }
  }

  return typeof possible === "object" && possible !== null ? possible : {};
}

export function isDocumentFinished(payload = {}) {
  const status = getDocumentStatus(payload);
  const values = collectStringValues(payload).join(" ").toLowerCase();

  const finishedTokens = [
    "certificated",
    "certificate",
    "document_ready",
    "assinado",
    "assinada",
    "signed",
    "completed",
    "complete",
    "concluido",
    "concluído",
    "concluida",
    "concluída",
    "finalizado",
    "finalizada",
    "finished",
    "ready",
  ];

  const pendingTokens = [
    "metadata_processing",
    "metadata_ready",
    "processing",
    "uploading",
    "uploaded",
    "pending",
    "pending_signature",
    "pendente",
    "waiting",
    "aguardando",
    "created",
    "criado",
    "sent",
    "enviado",
    "opened",
    "visualizado",
  ];

  if (status && pendingTokens.includes(status)) return false;
  if (status === "certificating") return false;
  return finishedTokens.some((token) => values.includes(token));
}

export function isDocumentBlockedForAssignment(payload = {}, method = process.env.ASSINAFY_SIGNATURE_METHOD || "collect") {
  const status = getDocumentStatus(payload);

  if (String(method).toLowerCase() === "collect") {
    // A Assinafy exige status metadata_ready para assinatura com campos.
    return status !== "metadata_ready";
  }

  return ["metadata_processing", "processing", "uploading", "creating", "queued"].includes(status);
}

export function getDocumentStatus(payload = {}) {
  return String(
    payload?.status ||
      payload?.document_status ||
      payload?.data?.status ||
      payload?.data?.document_status ||
      payload?.document?.status ||
      payload?.object?.status ||
      payload?.payload?.status ||
      payload?.payload?.document?.status ||
      ""
  ).toLowerCase();
}

function collectStringValues(value, acc = []) {
  if (value == null) return acc;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectStringValues(item, acc));
    return acc;
  }

  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, acc));
  }

  return acc;
}

export async function getDocumentData(documentId) {
  const baseUrl = getAssinafyBaseUrl();
  const urls = [`${baseUrl}/documents/${documentId}`];

  if (process.env.ASSINAFY_ACCOUNT_ID) {
    urls.push(`${baseUrl}/accounts/${process.env.ASSINAFY_ACCOUNT_ID}/documents/${documentId}`);
  }

  for (const url of urls) {
    const response = await fetch(url, { headers: getAssinafyHeaders() });
    const data = await response.json().catch(() => null);

    if (response.ok) return data?.data || data || null;
  }

  return null;
}

export async function downloadFinalPdf(documentId, documentData = null) {
  const data = documentData || (await getDocumentData(documentId));

  const directArtifactUrl =
    data?.artifacts?.certificated ||
    data?.artifacts?.certificate ||
    data?.artifacts?.bundle ||
    data?.artifacts?.signed ||
    data?.download_final_url ||
    data?.signed_url ||
    data?.final_url ||
    "";

  if (directArtifactUrl) {
    const response = await fetch(directArtifactUrl, { headers: getAssinafyHeaders() });
    if (response.ok) {
      return {
        pdfBuffer: Buffer.from(await response.arrayBuffer()),
        artifactName: directArtifactUrl.includes("bundle") ? "bundle" : "certificated",
      };
    }
  }

  const baseUrl = getAssinafyBaseUrl();
  const artifactNames = ["certificated", "certificate", "bundle", "signed", "final", "original"];
  const urls = [];

  for (const artifactName of artifactNames) {
    urls.push(`${baseUrl}/documents/${documentId}/download/${artifactName}`);
    urls.push(`${baseUrl}/documents/${documentId}/${artifactName}`);
    urls.push(`${baseUrl}/documents/${documentId}/download?artifact=${artifactName}`);

    if (process.env.ASSINAFY_ACCOUNT_ID) {
      urls.push(`${baseUrl}/accounts/${process.env.ASSINAFY_ACCOUNT_ID}/documents/${documentId}/download/${artifactName}`);
    }
  }

  let lastError = "";

  for (const url of urls) {
    const response = await fetch(url, { headers: getAssinafyHeaders() });

    if (response.ok) {
      return {
        pdfBuffer: Buffer.from(await response.arrayBuffer()),
        artifactName: url.split("/").pop() || "final",
      };
    }

    lastError = `${url}: ${response.status}`;
  }

  throw new Error(`Não foi possível baixar o PDF final da Assinafy. Último retorno: ${lastError}`);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
