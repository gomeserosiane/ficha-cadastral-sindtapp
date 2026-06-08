import fs from "node:fs/promises";
import { IncomingForm } from "formidable";
import {
  getAssinafyBaseUrl,
  getAssinafyHeaders,
  getDocumentData,
} from "../lib/assinafy.js";
import { saveDocumentMetadata } from "../lib/document-store.js";
import { getConfiguredFinalRecipients, isValidEmail, sendNewProponentNotificationEmail, sendSignerInvitationEmail } from "../lib/email.js";

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

    const sindicatoSignerEmail = process.env.ASSINAFY_SIGNER_EMAIL || process.env.ASSINAFY_ADMIN_SIGNER_EMAIL;
    const sindicatoSignerName = process.env.ASSINAFY_SIGNER_NAME || process.env.ASSINAFY_ADMIN_SIGNER_NAME || "Representante do Sindicato";

    if (!accountId) return sendJson(res, 500, { message: "Configure ASSINAFY_ACCOUNT_ID na Vercel." });
    if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_API_KEY ou ASSINAFY_ACCESS_TOKEN na Vercel." });
    }
    if (!sindicatoSignerEmail || !isValidEmail(sindicatoSignerEmail)) {
      return sendJson(res, 500, { message: "Configure ASSINAFY_SIGNER_EMAIL com o e-mail do signatário do sindicato." });
    }

    const finalRecipients = getConfiguredFinalRecipients().slice(0, 2);
    if (finalRecipients.length < 1) {
      return sendJson(res, 500, {
        message: "Configure pelo menos 1 e-mail final na Vercel: FINAL_DOCUMENT_EMAIL ou FINAL_DOCUMENT_EMAILS. Para 2 destinatários, use FINAL_DOCUMENT_EMAILS separado por vírgula ou FINAL_DOCUMENT_EMAIL_1 e FINAL_DOCUMENT_EMAIL_2.",
      });
    }

    const { fields, files } = await parseMultipartForm(req);
    const uploadedFile = getSingleFile(files.file);
    const proponenteEmail = getField(fields.recipientEmail);
    const proponenteName = getField(fields.recipientName) || "Proponente";
    const proponenteCpf = getField(fields.proponenteCpf);
    const proponenteNascimento = getField(fields.proponenteNascimento);
    const requestedDocumentName = getField(fields.documentName);

    if (!uploadedFile) return sendJson(res, 400, { message: "Nenhum PDF foi enviado." });
    if (!proponenteEmail || !isValidEmail(proponenteEmail)) {
      return sendJson(res, 400, { message: "E-mail do proponente titular inválido ou ausente." });
    }

    const documentName = normalizePdfFilename(
      requestedDocumentName || uploadedFile.originalFilename || `ficha-${slugify(proponenteName)}.pdf`
    );

    const metadata = {
      proponenteEmail,
      proponenteName,
      proponenteCpf,
      proponenteNascimento,
      sindicatoSignerEmail,
      sindicatoSignerName,
      finalRecipients,
      documentName,
      createdAt: new Date().toISOString(),
      flow: "sindtapp-dois-signatarios-assinafy-v4",
      assignmentStatus: "pending",
      assinaturaManualRemovida: true,
    };

    const fileBuffer = await fs.readFile(uploadedFile.filepath);

    const documentResult = await uploadPdfToDocuments({
      baseUrl,
      accountId,
      fileBuffer,
      filename: documentName,
    });

    const documentId = getDocumentId(documentResult);

    if (!documentId) {
      return sendJson(res, 500, {
        message: "Documento criado, mas não foi possível localizar o ID retornado pela Assinafy.",
        documentResult,
      });
    }

    let newProponentNotification = null;
    try {
      newProponentNotification = await sendNewProponentNotificationEmail({
        proponenteName,
        proponenteCpf,
        proponenteNascimento,
      });
    } catch (emailError) {
      console.error("[SINDTAPP] Falha ao enviar notificação de novo proponente:", emailError);
      newProponentNotification = { sent: false, error: emailError?.message || "Falha ao enviar notificação." };
    }

    saveDocumentMetadata(documentId, {
      ...metadata,
      newProponentNotification,
    });

    return sendJson(res, 202, {
      message: "Documento criado na Assinafy. A assinatura dos 2 signatários será iniciada assim que o processamento terminar.",
      documentId,
      proponenteEmail,
      sindicatoSignerEmail,
      finalRecipients,
      newProponentNotification,
      nextStep: `/api/start-assignment?documentId=${documentId}`,
      assignmentCreated: false,
    });
  } catch (error) {
    console.error("[SINDTAPP] Erro ao criar fluxo de assinatura:", error);
    return sendJson(res, 500, { message: error?.message || "Erro interno ao processar o envio para a Assinafy." });
  }
}

export async function startAssignmentFlow({ baseUrl, accountId, documentId, metadata }) {
  const proponenteEmail = metadata?.proponenteEmail;
  const proponenteName = metadata?.proponenteName || "Proponente";
  const sindicatoSignerEmail = metadata?.sindicatoSignerEmail || process.env.ASSINAFY_SIGNER_EMAIL || process.env.ASSINAFY_ADMIN_SIGNER_EMAIL;
  const sindicatoSignerName = metadata?.sindicatoSignerName || process.env.ASSINAFY_SIGNER_NAME || process.env.ASSINAFY_ADMIN_SIGNER_NAME || "Representante do Sindicato";

  if (!proponenteEmail || !isValidEmail(proponenteEmail)) {
    throw new Error("Não encontrei o e-mail do proponente para criar o 1º signatário na Assinafy.");
  }
  if (!sindicatoSignerEmail || !isValidEmail(sindicatoSignerEmail)) {
    throw new Error("Não encontrei o e-mail do sindicato para criar o 2º signatário na Assinafy.");
  }

  const [proponenteSigner, sindicatoSigner] = await Promise.all([
    findOrCreateSigner({ baseUrl, accountId, fullName: proponenteName, email: proponenteEmail }),
    findOrCreateSigner({ baseUrl, accountId, fullName: sindicatoSignerName, email: sindicatoSignerEmail }),
  ]);

  const proponenteSignerId = getSignerId(proponenteSigner);
  const sindicatoSignerId = getSignerId(sindicatoSigner);

  if (!proponenteSignerId) throw new Error("Não consegui criar/localizar o signatário PROPONENTE na Assinafy.");
  if (!sindicatoSignerId) throw new Error("Não consegui criar/localizar o signatário SINDICATO na Assinafy.");

  const assignmentMetadata = {
    ...metadata,
    proponenteSignerId,
    sindicatoSignerId,
    assignmentStatus: "created",
    assignmentCreatedAt: new Date().toISOString(),
  };

  const assignment = await createAssignmentForTwoSigners({
    baseUrl,
    documentId,
    proponenteSignerId,
    proponenteEmail,
    proponenteName,
    sindicatoSignerId,
    sindicatoSignerEmail,
    sindicatoSignerName,
    metadata: assignmentMetadata,
  });

  const signerInvitations = await notifySignersBySmtp({
    assignment,
    signers: [
      { email: proponenteEmail, name: proponenteName, role: "PROPONENTE" },
      { email: sindicatoSignerEmail, name: sindicatoSignerName, role: "SINDICATO" },
    ],
    documentName: metadata?.documentName,
  });

  saveDocumentMetadata(documentId, {
    ...assignmentMetadata,
    assignment,
    signerInvitations,
  });

  return {
    assignment,
    signerInvitations,
  };
}

async function uploadPdfToDocuments({ baseUrl, accountId, fileBuffer, filename }) {
  const formData = new FormData();
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
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const searchUrl = `${baseUrl}/accounts/${accountId}/signers?search=${encodeURIComponent(normalizedEmail)}`;
  const listResponse = await fetch(searchUrl, { headers: getAssinafyHeaders() });
  const listData = await listResponse.json().catch(() => null);

  const signers = Array.isArray(listData?.data) ? listData.data : [];
  const existing = signers.find((signer) => String(signer.email || "").toLowerCase() === normalizedEmail);
  if (existing) return existing;

  const response = await fetch(`${baseUrl}/accounts/${accountId}/signers`, {
    method: "POST",
    headers: { ...getAssinafyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, name: fullName, email: normalizedEmail }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `Erro ao criar signatário ${normalizedEmail} na Assinafy.`);
  return data?.data || data;
}

function getSignerId(signer = {}) {
  return signer?.id || signer?.uuid || signer?.signer_id;
}

async function createAssignmentForTwoSigners({
  baseUrl,
  documentId,
  proponenteSignerId,
  proponenteEmail,
  proponenteName,
  sindicatoSignerId,
  sindicatoSignerEmail,
  sindicatoSignerName,
  metadata,
}) {
  const method = String(process.env.ASSINAFY_SIGNATURE_METHOD || "collect").toLowerCase();

  if (method === "virtual") {
    const body = {
      method: "virtual",
      signers: [
        buildSignerPayload(proponenteSignerId),
        buildSignerPayload(sindicatoSignerId),
      ],
      message: process.env.ASSINAFY_SIGNATURE_MESSAGE || "Olá! Por favor, assine o documento enviado pelo SINDTAPP/PA.",
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
  const proponentePosition = getProponenteSignatureDisplaySettings(page);
  const sindicatoPosition = getSindicatoSignatureDisplaySettings(page);

  const body = {
    method: "collect",
    signers: [
      buildSignerPayload(proponenteSignerId),
      buildSignerPayload(sindicatoSignerId),
    ],
    entries: [
      {
        page_id: page.id,
        fields: [
          {
            signer_id: proponenteSignerId,
            field_id: signatureFieldId,
            display_settings: proponentePosition,
          },
          {
            signer_id: sindicatoSignerId,
            field_id: signatureFieldId,
            display_settings: sindicatoPosition,
          },
        ],
      },
    ],
    message:
      process.env.ASSINAFY_SIGNATURE_MESSAGE ||
      "Olá! Por favor, assine o documento no campo indicado para você na ficha SINDTAPP.",
    metadata,
    custom_data: metadata,
  };

  return postAssignment({ baseUrl, documentId, body });
}

function buildSignerPayload(signerId) {
  return {
    id: signerId,
    verification_method: "Email",
    notification_methods: ["Email"],
  };
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

function getProponenteSignatureDisplaySettings(page = {}) {
  if (process.env.ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON) {
    try {
      return JSON.parse(process.env.ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON);
    } catch {
      console.warn("ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON inválido. Usando posição padrão.");
    }
  }

  const widthScale = Number(page.width || 1275) / 595;
  const heightScale = Number(page.height || 2100) / 842;

  return {
    left: Math.round(50 * widthScale),
    top: Math.round(724 * heightScale),
    width: Math.round(170 * widthScale),
    height: Math.round(36 * heightScale),
    fontSize: 18,
    fontFamily: "Arial",
    backgroundColor: "rgb(195, 230, 203)",
  };
}

function getSindicatoSignatureDisplaySettings(page = {}) {
  if (process.env.ASSINAFY_SINDICATO_SIGNATURE_FIELD_JSON || process.env.ASSINAFY_SIGNATURE_FIELD_JSON) {
    try {
      return JSON.parse(process.env.ASSINAFY_SINDICATO_SIGNATURE_FIELD_JSON || process.env.ASSINAFY_SIGNATURE_FIELD_JSON);
    } catch {
      console.warn("ASSINAFY_SINDICATO_SIGNATURE_FIELD_JSON/ASSINAFY_SIGNATURE_FIELD_JSON inválido. Usando posição padrão.");
    }
  }

  const widthScale = Number(page.width || 1275) / 595;
  const heightScale = Number(page.height || 2100) / 842;

  return {
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

function extractSigningUrls(payload) {
  const url = extractSigningUrl(payload);
  return url ? [url] : [];
}

async function notifySignersBySmtp({ assignment, signers, documentName }) {
  const signUrls = extractSigningUrls(assignment);
  const firstUrl = signUrls[0] || "";

  if (!firstUrl) {
    console.warn("[SINDTAPP] Atribuição criada. A Assinafy deve enviar os convites, mas não retornou link direto no payload.");
    return signers.map((signer) => ({
      sent: false,
      email: signer.email,
      role: signer.role,
      reason: "A Assinafy não retornou link direto. Convite fica por conta da notification_methods da Assinafy.",
    }));
  }

  const results = [];
  for (const signer of signers) {
    try {
      await sendSignerInvitationEmail({
        to: signer.email,
        signerName: signer.name,
        documentName,
        signUrl: firstUrl,
      });
      results.push({ sent: true, email: signer.email, role: signer.role });
    } catch (error) {
      results.push({ sent: false, email: signer.email, role: signer.role, reason: error?.message });
    }
  }

  return results;
}

function parseMultipartForm(req) {
  const form = new IncomingForm({ multiples: false, keepExtensions: true, maxFileSize: 15 * 1024 * 1024 });
  return new Promise((resolve, reject) => {
    form.parse(req, (error, fields, files) => (error ? reject(error) : resolve({ fields, files })));
  });
}

function getSingleFile(fileValue) {
  return Array.isArray(fileValue) ? fileValue[0] : fileValue;
}

function getField(value) {
  const normalized = Array.isArray(value) ? value[0] : value;
  return String(normalized || "").trim();
}

function getDocumentId(documentResult) {
  return (
    documentResult?.id ||
    documentResult?.document_id ||
    documentResult?.uuid ||
    documentResult?.data?.id ||
    documentResult?.document?.id ||
    ""
  );
}

function normalizePdfFilename(value) {
  const filename = String(value || "documento.pdf").trim();
  return filename.toLowerCase().endsWith(".pdf") ? filename : `${filename}.pdf`;
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
