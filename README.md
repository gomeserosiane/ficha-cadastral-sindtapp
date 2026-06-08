# SINDTAPP + Assinafy — 2 signatários autenticados

## Fluxo implementado

1. O proponente preenche os dados no formulário e clica em **Enviar formulário**.
2. O front gera o PDF usando `docs/ficha-sindtapp.pdf` como modelo.
3. A assinatura manual/desenhada do formulário foi removida.
4. O PDF preenchido é enviado para a Assinafy pela rota `/api/assinafy-upload`.
5. O front chama `/api/start-assignment` em retry até o documento chegar no status `metadata_ready`.
6. O backend cria/localiza 2 signatários dentro da Assinafy:
   - **PROPONENTE**, usando o e-mail preenchido em `Dados do Proponente Titular`;
   - **SINDICATO**, usando `ASSINAFY_SIGNER_EMAIL`.
7. A assinatura `collect` cria 2 campos de assinatura no documento:
   - campo do PROPONENTE acima de **ASSINATURA DO(A) PROPONENTE**;
   - campo do SINDICATO acima de **ASSINATURA DO SINDICATO**.
8. A Assinafy envia a solicitação de assinatura para os 2 signatários por e-mail.
9. A cada novo envio, o sistema envia uma notificação para `FINAL_DOCUMENT_EMAIL_1` com a mensagem **Novo proponente cadastrado!!!**, contendo nome, CPF e data de nascimento do proponente.
10. Quando todos assinarem, o webhook `/api/assinafy-webhook` baixa o PDF final assinado/certificado e envia para até 2 e-mails finais configurados.
11. O campo **Estado civil** foi removido do formulário e da coleta de dados do projeto.

## Variáveis obrigatórias na Vercel

```env
ASSINAFY_API_KEY=sua_chave_assinafy
ASSINAFY_ACCOUNT_ID=id_do_workspace
ASSINAFY_BASE_URL=https://api.assinafy.com.br/v1

ASSINAFY_SIGNER_NAME=Nome do Signatário do Sindicato
ASSINAFY_SIGNER_EMAIL=email_do_sindicato@dominio.com
ASSINAFY_SIGNATURE_METHOD=collect

# E-mails finais que recebem o documento assinado/certificado quando todos assinarem.
# FINAL_DOCUMENT_EMAIL_1 também recebe a notificação de novo proponente cadastrado.
FINAL_DOCUMENT_EMAIL_1=email1@dominio.com
FINAL_DOCUMENT_EMAIL_2=email2@dominio.com

# Alternativas aceitas para destinatários finais:
FINAL_DOCUMENT_EMAIL=email1@dominio.com
FINAL_DOCUMENT_EMAILS=email1@dominio.com,email2@dominio.com

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=seuemail@gmail.com
SMTP_PASS=senha_de_app_google
EMAIL_FROM=SINDTAPP <seuemail@gmail.com>
```

## Variáveis opcionais

```env
# Use somente se a busca automática do campo signature não funcionar na sua conta.
ASSINAFY_SIGNATURE_FIELD_ID=id_do_campo_signature

# Sobrescreve manualmente a posição do campo do proponente.
ASSINAFY_PROPONENTE_SIGNATURE_FIELD_JSON={"left":107,"top":1805,"width":365,"height":90,"fontSize":18,"fontFamily":"Arial","backgroundColor":"rgb(195, 230, 203)"}

# Sobrescreve manualmente a posição do campo do sindicato.
ASSINAFY_SINDICATO_SIGNATURE_FIELD_JSON={"left":819,"top":1805,"width":350,"height":90,"fontSize":18,"fontFamily":"Arial","backgroundColor":"rgb(195, 230, 203)"}
```

## Webhook na Assinafy

Configure no painel da Assinafy:

```txt
https://SEU-DOMINIO.vercel.app/api/assinafy-webhook
```

## Rotas úteis

```txt
/api/test-email?email=seuemail@gmail.com
/api/debug-document?documentId=ID_DO_DOCUMENTO
/api/start-assignment?documentId=ID_DO_DOCUMENTO
/api/send-final-document?documentId=ID_DO_DOCUMENTO
```

## Deploy na Vercel

A raiz do projeto deve conter:

```txt
package.json
index.html
api/
css/
js/
lib/
docs/
img/
```

Na Vercel, deixe o **Root Directory** vazio ou como `./`.
