import nodemailer from "nodemailer";

export function getFinalRecipients({ metadata = {}, fallbackProponenteEmail = "" } = {}) {
  const emails = [
    ...(Array.isArray(metadata.finalRecipients) ? metadata.finalRecipients : []),
    metadata.proponenteEmail,
    fallbackProponenteEmail,
    metadata.sindicatoSignerEmail,
    process.env.ASSINAFY_SIGNER_EMAIL,
    process.env.ASSINAFY_ADMIN_SIGNER_EMAIL,
    process.env.FINAL_DOCUMENT_EMAIL_1,
    process.env.FINAL_DOCUMENT_EMAIL_2,
    process.env.FINAL_DOCUMENT_EMAIL_3,
  ];

  return [...new Set(
    emails
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(isValidEmail)
  )].slice(0, 4);
}

export async function sendFinalDocumentEmail({ to, recipientName, filename, pdfBuffer, artifactName }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = String(process.env.SMTP_SECURE || "true") === "true";
  const emailFrom = process.env.EMAIL_FROM || smtpUser;

  if (!smtpUser || !smtpPass || !emailFrom) {
    throw new Error("Configure SMTP_USER, SMTP_PASS e EMAIL_FROM para enviar o e-mail final.");
  }

  const validRecipients = [...new Set(
    (Array.isArray(to) ? to : [to])
      .map((email) => String(email || "").trim().toLowerCase())
      .filter(isValidEmail)
  )];

  if (!validRecipients.length) {
    throw new Error("Nenhum destinatário válido para envio do documento final.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: emailFrom,
    to: validRecipients.join(","),
    subject: "Documento assinado e concluído",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2>Documento assinado concluído</h2>
        <p>Olá.</p>
        <p>O documento de ${escapeHtml(recipientName || "proponente")} foi assinado e concluído.</p>
        <p>O arquivo final está anexado neste e-mail.</p>
        <hr />
        <small>Arquivo final enviado pela integração com a Assinafy. Artefato: ${escapeHtml(artifactName || "final")}.</small>
      </div>
    `,
    attachments: [
      {
        filename: filename || "documento-assinado.pdf",
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


export async function sendSignerInvitationEmail({ to, signerName, documentName, signUrl }) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpSecure = String(process.env.SMTP_SECURE || "true") === "true";
  const emailFrom = process.env.EMAIL_FROM || smtpUser;

  if (!smtpUser || !smtpPass || !emailFrom) {
    throw new Error("Configure SMTP_USER, SMTP_PASS e EMAIL_FROM para enviar o convite ao signatário.");
  }

  if (!isValidEmail(to)) {
    throw new Error("E-mail do signatário inválido para envio do convite.");
  }

  if (!signUrl) {
    throw new Error("A Assinafy criou a atribuição, mas não retornou link de assinatura para enviar ao signatário.");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.verify();

  await transporter.sendMail({
    from: emailFrom,
    to,
    subject: "Documento aguardando sua assinatura",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
        <h2>Documento aguardando sua assinatura</h2>
        <p>Olá, ${escapeHtml(signerName || "signatário")}.</p>
        <p>O documento <strong>${escapeHtml(documentName || "SINDTAPP")}</strong> foi gerado e está aguardando sua assinatura.</p>
        <p>
          <a href="${escapeHtml(signUrl)}" target="_blank" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;">
            Assinar documento
          </a>
        </p>
        <p>Se o botão não abrir, copie e cole este link no navegador:</p>
        <p style="word-break: break-all;">${escapeHtml(signUrl)}</p>
      </div>
    `,
  });
}
