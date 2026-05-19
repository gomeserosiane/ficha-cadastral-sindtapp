import { sendFinalDocumentEmail } from "../lib/email.js";

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return sendJson(res, 405, { message: "Método não permitido." });
  }

  try {
    const email = req.query?.email || process.env.TEST_EMAIL_TO || process.env.FINAL_DOCUMENT_EMAIL_1 || process.env.SMTP_USER;

    const samplePdf = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n190\n%%EOF"
    );

    await sendFinalDocumentEmail({
      to: [email],
      recipientName: "Teste SINDTAPP",
      filename: "teste-email-sindtapp.pdf",
      pdfBuffer: samplePdf,
      artifactName: "teste",
    });

    return sendJson(res, 200, {
      message: "E-mail de teste enviado. Verifique caixa de entrada e spam.",
      to: email,
    });
  } catch (error) {
    console.error("Erro no teste de e-mail:", error);
    return sendJson(res, 500, { message: error?.message || "Erro ao enviar e-mail de teste." });
  }
}

function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify(payload));
}
