import {
  downloadFinalPdf,
  extractDocumentId,
  extractMetadata,
  getDocumentData,
  isDocumentFinished,
} from "../lib/assinafy.js";
import { getDocumentMetadata, markEmailSent } from "../lib/document-store.js";
import { getFinalRecipients, isValidEmail, sendFinalDocumentEmail } from "../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : await readJsonBody(req);
    const documentId = extractDocumentId(body);

    if (!documentId) {
      console.log("[SINDTAPP] Webhook sem documentId:", JSON.stringify(body).slice(0, 2000));
      return sendJson(res, 200, {
        message: "Webhook recebido, mas sem documentId identificável.",
        emailSent: false,
      });
    }

    const documentData = await getDocumentData(documentId);
    const finished = isDocumentFinished(body) || isDocumentFinished(documentData);

    if (!finished) {
      return sendJson(res, 200, {
        message: "Webhook recebido, mas o documento ainda não está concluído/assinado.",
        documentId,
        status: documentData?.status || body?.status || null,
        emailSent: false,
      });
    }

    const storedMetadata = getDocumentMetadata(documentId);
    const metadata = mergeMetadata(
      storedMetadata,
      extractMetadata(body),
      extractMetadata(documentData)
    );

    if (metadata?.emailSent) {
      return sendJson(res, 200, {
        message: "Documento final já havia sido enviado por e-mail.",
        documentId,
        emailSent: true,
        skippedDuplicate: true,
      });
    }

    const fallbackProponenteEmail = extractEmailFromWebhook(body) || extractEmailFromDocument(documentData);
    const recipients = getFinalRecipients({
      metadata,
      fallbackProponenteEmail,
    });

    if (!recipients.length) {
      return sendJson(res, 200, {
        message: "Documento assinado, mas nenhum destinatário válido foi encontrado.",
        documentId,
        emailSent: false,
      });
    }

    const recipientName = metadata?.proponenteName || extractNameFromDocument(documentData) || "proponente";
    const filename = normalizeFilename(
      metadata?.documentName || documentData?.name || body?.object?.name || `ficha-${slugify(recipientName)}.pdf`
    );

    const { pdfBuffer, artifactName } = await downloadFinalPdf(documentId, documentData);

    await sendFinalDocumentEmail({
      to: recipients,
      recipientName,
      filename,
      pdfBuffer,
      artifactName,
    });

    markEmailSent(documentId, {
      ...metadata,
      finalRecipients: recipients,
      artifactSent: artifactName,
      webhookSent: true,
    });

    return sendJson(res, 200, {
      message: "Documento final assinado enviado por e-mail.",
      documentId,
      recipients,
      emailSent: true,
    });
  } catch (error) {
    console.error("[SINDTAPP] Erro no webhook:", error);
    return sendJson(res, 500, {
      message: error?.message || "Erro interno no webhook.",
    });
  }
}

function mergeMetadata(...items) {
  return Object.assign({}, ...items.filter((item) => item && typeof item === "object"));
}

function extractEmailFromDocument(documentData) {
  const signers = documentData?.assignment?.signers || documentData?.signers || documentData?.recipients || [];
  const firstEmailSigner = signers.find((signer) => isValidEmail(signer?.email));
  return firstEmailSigner?.email || "";
}

function extractNameFromDocument(documentData) {
  const signers = documentData?.assignment?.signers || documentData?.signers || documentData?.recipients || [];
  const firstNamedSigner = signers.find((signer) => signer?.full_name || signer?.name);
  return firstNamedSigner?.full_name || firstNamedSigner?.name || "";
}

function extractEmailFromWebhook(body) {
  return (
    body?.recipientEmail ||
    body?.payload?.recipientEmail ||
    body?.object?.recipientEmail ||
    body?.object?.email ||
    body?.payload?.object?.email ||
    body?.data?.email ||
    ""
  );
}

function normalizeFilename(value) {
  const filename = String(value || "documento-assinado.pdf").trim();
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
