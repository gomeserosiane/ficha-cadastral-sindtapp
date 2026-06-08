import {
  getAssinafyBaseUrl,
  getDocumentData,
  getDocumentStatus,
  isDocumentBlockedForAssignment,
} from "../lib/assinafy.js";
import { getDocumentMetadata, saveDocumentMetadata } from "../lib/document-store.js";
import { startAssignmentFlow } from "./assinafy-upload.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const documentId = req.query?.documentId || req.query?.id || req.body?.documentId || req.body?.id;

    if (!documentId) {
      return sendJson(res, 400, {
        message: "Informe documentId. Exemplo: /api/start-assignment?documentId=ID_DO_DOCUMENTO",
      });
    }

    const documentData = await getDocumentData(documentId);
    const status = getDocumentStatus(documentData);
    const method = process.env.ASSINAFY_SIGNATURE_METHOD || "collect";

    if (!documentData || isDocumentBlockedForAssignment(documentData, method)) {
      return sendJson(res, 202, {
        message: method === "collect"
          ? "Documento ainda não chegou em metadata_ready na Assinafy. Tente novamente em alguns segundos."
          : "Documento ainda está processando na Assinafy. Tente novamente em alguns segundos.",
        documentId,
        status: status || "metadata_processing",
        assignmentCreated: false,
      });
    }

    const savedMetadata = getDocumentMetadata(documentId) || {};
    const fallbackMetadata = buildMetadataFromRequest(req);
    const metadata = {
      ...fallbackMetadata,
      ...savedMetadata,
      // Prioriza os dados enviados agora pelo formulário quando o store local da Vercel não existir
      // ou quando a requisição cair em outra Function sem acesso ao /tmp anterior.
      proponenteEmail: savedMetadata.proponenteEmail || fallbackMetadata.proponenteEmail,
      proponenteName: savedMetadata.proponenteName || fallbackMetadata.proponenteName,
      proponenteCpf: savedMetadata.proponenteCpf || fallbackMetadata.proponenteCpf,
      proponenteNascimento: savedMetadata.proponenteNascimento || fallbackMetadata.proponenteNascimento,
      sindicatoSignerEmail: savedMetadata.sindicatoSignerEmail || fallbackMetadata.sindicatoSignerEmail,
      sindicatoSignerName: savedMetadata.sindicatoSignerName || fallbackMetadata.sindicatoSignerName,
      finalRecipients: savedMetadata.finalRecipients || fallbackMetadata.finalRecipients,
      documentName: savedMetadata.documentName || fallbackMetadata.documentName,
    };

    if (!metadata.proponenteEmail) {
      return sendJson(res, 500, {
        message: "Não encontrei o e-mail do proponente para criar o 1º signatário. Verifique se o campo E-mail em Dados do proponente titular está preenchido e tente novamente.",
      });
    }

    // Regrava os metadados antes de criar os signatários para o webhook também conseguir
    // recuperar os destinatários finais depois que todos assinarem.
    saveDocumentMetadata(documentId, metadata);

    const assignmentResult = await startAssignmentFlow({
      baseUrl: getAssinafyBaseUrl(),
      accountId: process.env.ASSINAFY_ACCOUNT_ID,
      documentId,
      metadata,
    });

    saveDocumentMetadata(documentId, {
      ...metadata,
      assignmentStatus: "created",
      assignment: assignmentResult?.assignment || assignmentResult,
      signerInvitations: assignmentResult?.signerInvitations || null,
      assignmentCreatedAt: new Date().toISOString(),
    });

    return sendJson(res, 200, {
      message: "Atribuição criada para PROPONENTE e SINDICATO na Assinafy.",
      documentId,
      proponenteEmail: metadata.proponenteEmail,
      sindicatoSignerEmail: metadata.sindicatoSignerEmail,
      assignmentCreated: true,
      signerInvitations: assignmentResult?.signerInvitations || null,
      assignment: assignmentResult?.assignment || assignmentResult,
    });
  } catch (error) {
    console.error("[SINDTAPP] Erro ao iniciar atribuição:", error);
    return sendJson(res, 500, {
      message: error?.message || "Erro ao iniciar assinatura.",
    });
  }
}

function getRequestValue(req, key) {
  const fromBody = req.body?.[key];
  const fromQuery = req.query?.[key];
  const value = Array.isArray(fromBody) ? fromBody[0] : (fromBody ?? fromQuery);
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function buildMetadataFromRequest(req) {
  const finalRecipientsFromBody = getRequestValue(req, "finalRecipients");
  const finalRecipientsFromEnv = [
    process.env.FINAL_DOCUMENT_EMAIL,
    process.env.FINAL_DOCUMENT_EMAIL_1,
    process.env.FINAL_DOCUMENT_EMAIL_2,
    ...(process.env.FINAL_DOCUMENT_EMAILS || "").split(","),
  ]
    .map((email) => String(email || "").trim())
    .filter(Boolean);

  return {
    proponenteEmail: getRequestValue(req, "proponenteEmail") || getRequestValue(req, "recipientEmail"),
    proponenteName: getRequestValue(req, "proponenteName") || getRequestValue(req, "recipientName") || "Proponente",
    proponenteCpf: getRequestValue(req, "proponenteCpf"),
    proponenteNascimento: getRequestValue(req, "proponenteNascimento"),
    sindicatoSignerEmail: getRequestValue(req, "sindicatoSignerEmail") || process.env.ASSINAFY_SIGNER_EMAIL || process.env.ASSINAFY_ADMIN_SIGNER_EMAIL,
    sindicatoSignerName: getRequestValue(req, "sindicatoSignerName") || process.env.ASSINAFY_SIGNER_NAME || process.env.ASSINAFY_ADMIN_SIGNER_NAME || "Representante do Sindicato",
    finalRecipients: finalRecipientsFromBody
      ? finalRecipientsFromBody.split(",").map((email) => email.trim()).filter(Boolean)
      : finalRecipientsFromEnv,
    documentName: getRequestValue(req, "documentName"),
    createdAt: new Date().toISOString(),
    flow: "sindtapp-dois-signatarios-assinafy-v5-metadata-fallback",
    assignmentStatus: "pending",
    assinaturaManualRemovida: true,
  };
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
