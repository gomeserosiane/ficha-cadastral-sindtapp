import { extractDocumentId, getDocumentData } from "../lib/assinafy.js";
import { getDocumentMetadata } from "../lib/document-store.js";

export default async function handler(req, res) {
  try {
    const documentId = req.query?.documentId || req.query?.id;

    if (!documentId) {
      return sendJson(res, 400, {
        message: "Informe documentId. Exemplo: /api/debug-document?documentId=ID_DO_DOCUMENTO",
      });
    }

    const documentData = await getDocumentData(documentId);
    const metadata = getDocumentMetadata(documentId);

    return sendJson(res, 200, {
      documentId,
      metadata,
      documentStatus: documentData?.status || documentData?.document_status || null,
      documentName: documentData?.name || null,
      hasArtifacts: !!documentData?.artifacts,
      artifacts: documentData?.artifacts || null,
      documentDataPreview: documentData,
    });
  } catch (error) {
    return sendJson(res, 500, { message: error?.message || "Erro ao consultar documento." });
  }
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
