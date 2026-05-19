import { downloadFinalPdf, getDocumentData, isDocumentFinished } from "../lib/assinafy.js";
import { getDocumentMetadata, markEmailSent } from "../lib/document-store.js";
import { getFinalRecipients, sendFinalDocumentEmail } from "../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const documentId = req.query?.documentId || req.query?.id || req.body?.documentId || req.body?.id;

    if (!documentId) {
      return sendJson(res, 400, {
        message: "Informe documentId. Exemplo: /api/send-final-document?documentId=ID_DO_DOCUMENTO",
      });
    }

    const documentData = await getDocumentData(documentId);
    const metadata = getDocumentMetadata(documentId) || {};
    const requireFinished = String(process.env.REQUIRE_FINISHED_STATUS || "true") === "true";

    if (requireFinished && !isDocumentFinished(documentData)) {
      return sendJson(res, 200, {
        message: "Documento encontrado, mas ainda não parece finalizado/assinado.",
        documentId,
        status: documentData?.status || null,
        emailSent: false,
      });
    }

    const recipients = getFinalRecipients({
      metadata,
      fallbackProponenteEmail: req.query?.proponenteEmail || req.body?.proponenteEmail || "",
    });

    if (!recipients.length) {
      return sendJson(res, 400, {
        message: "Nenhum destinatário encontrado. Confira FINAL_DOCUMENT_EMAIL_1/2 e dados do envio inicial.",
        documentId,
      });
    }

    const { pdfBuffer, artifactName } = await downloadFinalPdf(documentId, documentData);
    const filename = metadata?.documentName || documentData?.name || `documento-assinado-${documentId}.pdf`;

    await sendFinalDocumentEmail({
      to: recipients,
      recipientName: metadata?.proponenteName || "proponente",
      filename,
      pdfBuffer,
      artifactName,
    });

    markEmailSent(documentId, {
      ...metadata,
      finalRecipients: recipients,
      artifactSent: artifactName,
      manualSend: true,
    });

    return sendJson(res, 200, {
      message: "Documento final enviado manualmente.",
      documentId,
      recipients,
      artifactName,
    });
  } catch (error) {
    console.error("[SINDTAPP] Erro no envio manual:", error);
    return sendJson(res, 500, { message: error?.message || "Erro ao enviar documento final." });
  }
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
