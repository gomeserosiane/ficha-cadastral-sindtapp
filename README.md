# SINDTAPP + Assinafy — Projeto corrigido para Vercel

## Fluxo implementado

1. O proponente preenche os dados no formulário e clica em **Enviar formulário**.
2. O front gera o PDF usando `docs/ficha-sindtapp.pdf` como modelo.
3. Os dados são preenchidos no PDF nas posições mapeadas no arquivo `js/script.js`.
4. O PDF preenchido é enviado para a Assinafy pela rota `/api/assinafy-upload`.
5. O front chama `/api/start-assignment` em retry até o documento chegar no status `metadata_ready`.
6. Quando o documento está pronto, o backend cria/localiza o signatário e cria uma assinatura do tipo `collect`.
7. A assinatura `collect` cria automaticamente o campo de assinatura acima de **ASSINATURA DO SINDICATO**.
8. O signatário recebe o convite pelo e-mail da própria Assinafy e, como reforço, pelo SMTP configurado no projeto quando a API retornar o link de assinatura.
9. Quando o documento for finalizado/certificado na Assinafy, o webhook `/api/assinafy-webhook` baixa o PDF final e envia para até 4 e-mails:
   - e-mail do proponente preenchido no formulário;
   - e-mail do signatário;
   - `FINAL_DOCUMENT_EMAIL_1`;
   - `FINAL_DOCUMENT_EMAIL_2`.

## Principais correções feitas

- Corrigido o payload da assinatura `collect` da Assinafy.
- Adicionado uso real de `entries`, `page_id`, `field_id` e `display_settings`.
- Adicionada busca automática do campo padrão de assinatura na Assinafy via `/accounts/{accountId}/fields?include_standard=true`.
- Adicionado suporte para `ASSINAFY_SIGNATURE_FIELD_ID`, caso você queira informar manualmente o ID do campo signature.
- Corrigido bloqueio de status: assinatura `collect` só inicia quando o documento chega em `metadata_ready`.
- Removido o bloqueio obrigatório da assinatura manual do proponente no front.
- Mantida a assinatura manual como opcional.
- Corrigido valor total inicial para começar em R$ 35,00, considerando o proponente titular.
- Mantido retry automático enquanto a Assinafy processa o PDF.
- Validado o projeto com `node --check` em todas as rotas e bibliotecas.

## Variáveis obrigatórias na Vercel

```env
ASSINAFY_API_KEY=sua_chave_assinafy
ASSINAFY_ACCOUNT_ID=id_do_workspace
ASSINAFY_BASE_URL=https://api.assinafy.com.br/v1

ASSINAFY_SIGNER_NAME=Nome do Signatário
ASSINAFY_SIGNER_EMAIL=email_do_signatario@dominio.com
ASSINAFY_SIGNATURE_METHOD=collect

FINAL_DOCUMENT_EMAIL_1=email3@dominio.com
FINAL_DOCUMENT_EMAIL_2=email4@dominio.com

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

# Use somente se quiser sobrescrever manualmente a posição do campo de assinatura.
ASSINAFY_SIGNATURE_FIELD_JSON={"left":740,"top":1700,"width":380,"height":105,"fontSize":18,"fontFamily":"Arial","backgroundColor":"rgb(195, 230, 203)"}

# Use sandbox durante testes.
ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1
```

## Webhook na Assinafy

Configure a URL abaixo no painel da Assinafy:

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

