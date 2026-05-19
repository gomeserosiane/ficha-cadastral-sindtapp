import fs from "node:fs/promises";
import { IncomingForm } from "formidable";
import {
  getAssinafyBaseUrl,
  getAssinafyHeaders,
  getDocumentData,
} from "../lib/assinafy.js";
import { saveDocumentMetadata } from "../lib/document-store.js";
import { isValidEmail, sendSignerInvitationEmail } from "../lib/email.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const accountId = process.env.ASSINAFY_ACCOUNT_ID;
    const baseUrl = getAssinafyBaseUrl();

    const signerEmail = process.env.ASSINAFY_SIGNER_EMAIL || process.env.ASSINAFY_ADMIN_SIGNER_EMAIL;
    const signerName = process.env.ASSINAFY_SIGNER_NAME || process.env.ASSINAFY_ADMIN_SIGNER_NAME || "Representante do Sindicato";

    if (!accountId) return sendJson(res, 500, { message: "Configure ASSINAFY_ACCOUNT_ID na Vercel." });
    if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN na Vercel." });
    }
    if (!signerEmail || !isValidEmail(signerEmail)) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_SIGNER_EMAIL com o e-mail do signatário." });
    }

    const { fields, files } = await parseMultipartForm(req);
    const uploadedFile = getSingleFile(files.file);
    const proponenteEmail = getField(fields.recipientEmail);
    const proponenteName = getField(fields.recipientName) || "Proponente";
    const requestedDocumentName = getField(fields.documentName);

    if (!uploadedFile) return sendJson(res, 400, { message: "Nenhum PDF foi enviado." });
    if (!proponenteEmail || !isValidEmail(proponenteEmail)) {
      return sendJson(res, 400, { message: "E-mail do proponente titular inválido ou ausente." });
    }

    const documentName = normalizePdfFilename(
      requestedDocumentName || uploadedFile.originalFilename || `ficha-${slugify(proponenteName)}.pdf`
    );

    const finalRecipients = buildFinalRecipients({
      proponenteEmail,
      signerEmail,
      extraEmails: [process.env.FINAL_DOCUMENT_EMAIL_1, process.env.FINAL_DOCUMENT_EMAIL_2],
    });

    const metadata = {
      proponenteEmail,
      proponenteName,
      sindicatoSignerEmail: signerEmail,
      sindicatoSignerName: signerName,
      finalRecipients,
      documentName,
      createdAt: new Date().toISOString(),
      flow: "sindtapp-document-signature-email-final-v3",
      assignmentStatus: "pending",
    };

    const fileBuffer = await fs.readFile(uploadedFile.filepath);

    const documentResult = await uploadPdfToDocuments({
      baseUrl,
      accountId,
      fileBuffer,
      filename: documentName,
      metadata,
    });

    const documentId = getDocumentId(documentResult);

    if (!documentId) {
      return sendJson(res, 500, {
        message: "Documento criado, mas não foi possível localizar o ID retornado pela Assinafy.",
        documentResult,
      });
    }

    saveDocumentMetadata(documentId, metadata);

    // IMPORTANTE:
    // Não criamos a atribuição nesta mesma requisição. A Assinafy pode devolver o documento
    // com status metadata_processing por alguns segundos. Se tentarmos criar a atribuição
    // neste momento, a API retorna erro.
    //
    // Por isso, o fluxo agora é em 2 etapas:
    // 1) /api/assinafy-upload cria apenas o documento;
    // 2) o front chama /api/start-assignment em loop até a Assinafy permitir criar a atribuição.
    return sendJson(res, 202, {
      message: "Documento criado na Assinafy. A assinatura será iniciada assim que o processamento terminar.",
      documentId,
      signerEmail,
      proponenteEmail,
      finalRecipients,
      nextStep: `/api/start-assignment?documentId=${documentId}`,
      assignmentCreated: false,
    });
  } catch (error) {
    console.error("[SINDTAPP] Erro ao criar fluxo de assinatura:", error);
    return sendJson(res, 500, { message: error?.message || "Erro interno ao processar o envio para a Assinafy." });
  }
}

export async function startAssignmentFlow({ baseUrl, accountId, documentId, signerEmail, signerName, metadata }) {
  const signer = await findOrCreateSigner({
    baseUrl,
    accountId,
    fullName: signerName,
    email: signerEmail,
  });

  const signerId = signer?.id || signer?.uuid || signer?.signer_id;

  if (!signerId) {
    throw new Error("Documento criado, mas não consegui criar/localizar o signatário.");
  }

  const assignment = await createAssignment({
    baseUrl,
    documentId,
    signerId,
    signerEmail,
    signerName,
    metadata: {
      ...metadata,
      signerId,
      assignmentStatus: "created",
      assignmentCreatedAt: new Date().toISOString(),
    },
  });

  const signerInvitation = await notifySignerBySmtp({
    assignment,
    signerEmail,
    signerName,
    documentName: metadata?.documentName,
  });

  saveDocumentMetadata(documentId, {
    ...metadata,
    signerId,
    assignment,
    signerInvitation,
    assignmentStatus: "created",
    assignmentCreatedAt: new Date().toISOString(),
  });

  return {
    assignment,
    signerInvitation,
  };
}

async function uploadPdfToDocuments({ baseUrl, accountId, fileBuffer, filename, metadata }) {
  const formData = new FormData();
  // A Assinafy espera o upload do documento como multipart contendo apenas o campo "file".
  // Metadados do fluxo ficam guardados no backend deste projeto após a API retornar o documentId.
  formData.append("file", new Blob([fileBuffer], { type: "application/pdf" }), filename);

  const response = await fetch(`${baseUrl}/accounts/${accountId}/documents`, {
    method: "POST",
    headers: getAssinafyHeaders(),
    body: formData,
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) throw new Error(data?.message || data?.error || "Erro ao criar documento na Assinafy.");
  return data?.data || data;
}

async function findOrCreateSigner({ baseUrl, accountId, fullName, email }) {
  const searchUrl = `${baseUrl}/accounts/${accountId}/signers?search=${encodeURIComponent(email)}`;
  const listResponse = await fetch(searchUrl, { headers: getAssinafyHeaders() });
  const listData = await listResponse.json().catch(() => null);

  const signers = Array.isArray(listData?.data) ? listData.data : [];
  const existing = signers.find((signer) => String(signer.email || "").toLowerCase() === email.toLowerCase());
  if (existing) return existing;

  const response = await fetch(`${baseUrl}/accounts/${accountId}/signers`, {
    method: "POST",
    headers: { ...getAssinafyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, name: fullName, email }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `Erro ao criar signatário ${email} na Assinafy.`);
  return data?.data || data;
}

async function createAssignment({ baseUrl, documentId, signerId, signerEmail, signerName, metadata }) {
  const method = String(process.env.ASSINAFY_SIGNATURE_METHOD || "collect").toLowerCase();

  if (method === "virtual") {
    const body = {
      method: "virtual",
      signers: [
        {
          id: signerId,
          verification_method: "Email",
          notification_methods: ["Email"],
        },
      ],
      message:
        process.env.ASSINAFY_SIGNATURE_MESSAGE ||
        "Olá! Por favor, assine o documento enviado pelo SINDTAPP/PA.",
      metadata,
      custom_data: metadata,
    };

    return postAssignment({ baseUrl, documentId, body });
  }

  const documentData = await getDocumentData(documentId);
  const page = getFirstPage(documentData);

  if (!page?.id) {
    throw new Error("Não consegui localizar o page_id do PDF na Assinafy. Aguarde o status metadata_ready e tente novamente.");
  }

  const signatureFieldId = await resolveSignatureFieldId({ baseUrl, accountId: process.env.ASSINAFY_ACCOUNT_ID });
  const signaturePosition = getSindicatoSignatureDisplaySettings(page);

  const body = {
    method: "collect",
    signers: [
      {
        id: signerId,
        verification_method: "Email",
        notification_methods: ["Email"],
      },
    ],
    entries: [
      {
        page_id: page.id,
        fields: [
          {
            signer_id: signerId,
            field_id: signatureFieldId,
            display_settings: signaturePosition,
          },
        ],
      },
    ],
    message:
      process.env.ASSINAFY_SIGNATURE_MESSAGE ||
      "Olá! Por favor, assine o documento no campo ASSINATURA DO SINDICATO.",
    metadata,
    custom_data: metadata,
  };

  return postAssignment({ baseUrl, documentId, body });
}

async function postAssignment({ baseUrl, documentId, body }) {
  const response = await fetch(`${baseUrl}/documents/${documentId}/assignments`, {
    method: "POST",
    headers: { ...getAssinafyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        `Documento criado, mas falhou ao solicitar assinatura na Assinafy. Status HTTP: ${response.status}`
    );
  }
  return data?.data || data;
}

function getFirstPage(documentData) {
  const pages = documentData?.pages || documentData?.document?.pages || documentData?.data?.pages || [];
  return Array.isArray(pages) ? pages[0] : null;
}

async function resolveSignatureFieldId({ baseUrl, accountId }) {
  if (process.env.ASSINAFY_SIGNATURE_FIELD_ID) return process.env.ASSINAFY_SIGNATURE_FIELD_ID;

  if (!accountId) {
    throw new Error("Configure ASSINAFY_ACCOUNT_ID para localizar o campo de assinatura padrão.");
  }

  const url = `${baseUrl}/accounts/${accountId}/fields?include_standard=true&include_inactive=false`;
  const response = await fetch(url, { headers: getAssinafyHeaders() });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || "Não foi possível listar os campos padrão da Assinafy.");
  }

  const fields = Array.isArray(data?.data) ? data.data : [];
  const signatureField = fields.find((field) => String(field?.type || "").toLowerCase() === "signature");

  if (!signatureField?.id) {
    throw new Error("Não encontrei o field_id padrão de assinatura. Configure ASSINAFY_SIGNATURE_FIELD_ID na Vercel.");
  }

  return signatureField.id;
}

function getSindicatoSignatureDisplaySettings(page = {}) {
  if (process.env.ASSINAFY_SIGNATURE_FIELD_JSON) {
    try {
      return JSON.parse(process.env.ASSINAFY_SIGNATURE_FIELD_JSON);
    } catch {
      console.warn("ASSINAFY_SIGNATURE_FIELD_JSON inválido. Usando posição padrão.");
    }
  }

  // A API da Assinafy usa o tamanho renderizado da página, normalmente maior que o PDF em pontos.
  // O PDF modelo tem ~595x842 pontos; no retorno da Assinafy o exemplo comum vem em ~1275x2100.
  // A área "ASSINATURA DO SINDICATO" fica no canto inferior direito da primeira página,
  // com o pontilhado em aproximadamente y=764 e o texto logo abaixo.
  // Portanto, o campo deve começar acima do pontilhado, sem cobrir a legenda.
  const widthScale = Number(page.width || 1275) / 595;
  const heightScale = Number(page.height || 2100) / 842;

  return {
    // Alinhado ao bloco direito, exatamente acima de "ASSINATURA DO SINDICATO".
    left: Math.round(382 * widthScale),
    top: Math.round(724 * heightScale),
    width: Math.round(164 * widthScale),
    height: Math.round(36 * heightScale),
    fontSize: 18,
    fontFamily: "Arial",
    backgroundColor: "rgb(195, 230, 203)",
  };
}


function extractSigningUrl(payload) {
  const urls = [];

  function walk(value) {
    if (!value) return;

    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value === "object") {
      Object.entries(value).forEach(([key, val]) => {
        const lowerKey = String(key).toLowerCase();

        if (
          typeof val === "string" &&
          /^https?:\/\//i.test(val) &&
          (
            lowerKey.includes("sign") ||
            lowerKey.includes("assin") ||
            lowerKey.includes("collect") ||
            lowerKey.includes("url") ||
            lowerKey.includes("link")
          )
        ) {
          urls.push(val);
        }

        walk(val);
      });
    }
  }

  walk(payload);

  const preferred = urls.find((url) => /sign|assin|collect|token|signature/i.test(url));
  return preferred || urls[0] || "";
}

async function notifySignerBySmtp({ assignment, signerEmail, signerName, documentName }) {
  const signUrl = extractSigningUrl(assignment);

  if (!signUrl) {
    console.warn("[SINDTAPP] Atribuição criada, mas a Assinafy não retornou link de assinatura no payload.");
    return {
      sent: false,
      reason: "A Assinafy não retornou link de assinatura no payload da atribuição.",
    };
  }

  await sendSignerInvitationEmail({
    to: signerEmail,
    signerName,
    documentName,
    signUrl,
  });

  return {
    sent: true,
    signUrl,
  };
}


function parseMultipartForm(req) {
  const form = new IncomingForm({ multiples: false, keepExtensions: true, maxFileSize: 15 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => (error ? reject(error) : resolve({ fields, files })));
  });
}

function buildFinalRecipients({ proponenteEmail, signerEmail, extraEmails }) {
  const emails = [proponenteEmail, signerEmail, ...extraEmails]
    .map((email) => String(email || "").trim().toLowerCase())
    .filter(isValidEmail);
  return [...new Set(emails)].slice(0, 4);
}

function getSingleFile(fileValue) {
  return Array.isArray(fileValue) ? fileValue[0] : fileValue;
}

function getField(fieldValue) {
  const value = Array.isArray(fieldValue) ? fieldValue[0] : fieldValue;
  return String(value || "").trim();
}

function getDocumentId(data) {
  return data?.data?.id || data?.id || data?.document?.id || data?.data?.document?.id || data?.uuid || "";
}

function normalizePdfFilename(value) {
  const filename = String(value || "ficha-sindtapp.pdf").trim().replace(/[^a-zA-Z0-9À-ÿ._ -]/g, "").replace(/\s+/g, "-").toLowerCase();
  return filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
}

function slugify(value) {
  return String(value || "usuario")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
