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

    const metadata = getDocumentMetadata(documentId) || {};

    if (!metadata.proponenteEmail) {
      return sendJson(res, 500, {
        message: "Não encontrei os dados do proponente para criar o 1º signatário. Reenvie o formulário para registrar os metadados corretamente.",
      });
    }

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

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
