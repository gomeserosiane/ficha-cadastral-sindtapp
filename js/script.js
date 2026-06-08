
function isAssinafyDocumentFullySigned(payload = {}) {
  const rawStatus = String(
    payload.status ||
    payload.document_status ||
    payload.document?.status ||
    payload.data?.status ||
    payload.data?.document?.status ||
    payload.event ||
    ""
  ).toLowerCase();

  const finishedStatuses = [
    "assinado",
    "signed",
    "completed",
    "complete",
    "concluido",
    "concluído",
    "finalizado",
    "finished"
  ];

  return finishedStatuses.some((status) => rawStatus.includes(status));
}

// ===============================
// ELEMENTOS DOM
// ===============================
const form1 = document.getElementById("cadastroForm1");
const proponentesContainer = document.getElementById("proponentes-container");
const addProponenteBtn = document.getElementById("addProponenteBtn");
const gerarTotalBtn = document.getElementById("gerarTotalBtn");
const valorTotalOutput = document.getElementById("valorTotal");
const dadosPagadorSection = document.getElementById("dados-pagador-section");
const submitBtn = document.querySelector(".submit-btn");
const formaPagamentoRadios = document.querySelectorAll('input[name="formaPagamento"]');
const paymentPanels = document.querySelectorAll("[data-payment-panel]");

const VALOR_POR_PESSOA = 35;
const MAX_PROPONENTES_VINCULADOS = 5;
let pagadorAlertShown = false;

// ===============================
// FUNÇÕES AUXILIARES
// ===============================
function onlyNumbers(value) {
  return (value || "").replace(/\D/g, "");
}

function formatCPF(value) {
  value = onlyNumbers(value).slice(0, 11);
  value = value.replace(/(\d{3})(\d)/, "$1.$2");
  value = value.replace(/(\d{3})(\d)/, "$1.$2");
  value = value.replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return value;
}

function formatCEP(value) {
  value = onlyNumbers(value).slice(0, 8);
  value = value.replace(/(\d{5})(\d)/, "$1-$2");
  return value;
}

function formatPhone(value) {
  value = onlyNumbers(value).slice(0, 11);

  if (value.length <= 10) {
    value = value.replace(/(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d{4})(\d)/, "$1-$2");
  } else {
    value = value.replace(/(\d{2})(\d)/, "($1) $2");
    value = value.replace(/(\d{5})(\d)/, "$1-$2");
  }

  return value;
}

function formatDateBR(value) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatCurrencyBR(value) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function slugify(value) {
  return String(value || "documento")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "documento";
}

function getFieldValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function setFieldValue(id, value) {
  const field = document.getElementById(id);
  if (field) field.value = value || "";
}

// ===============================
// MÁSCARAS
// ===============================
["f1_cpf", "pagador_cpf"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatCPF(event.target.value);
  });
});

["f1_cep", "pagador_cep"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatCEP(event.target.value);
  });
});

["f1_telefone", "pagador_telefone"].forEach((id) => {
  const input = document.getElementById(id);
  input?.addEventListener("input", (event) => {
    event.target.value = formatPhone(event.target.value);
  });
});

// ===============================
// VIA CEP
// ===============================
async function buscarCEP(cep, prefix) {
  const cepLimpo = onlyNumbers(cep);
  if (cepLimpo.length !== 8) return;

  try {
    const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    const data = await response.json();

    if (data.erro) {
      alert("CEP não encontrado.");
      return;
    }

    const enderecoInput = document.getElementById(`${prefix}_endereco`);
    const bairroInput = document.getElementById(`${prefix}_bairro`);
    const cidadeInput = document.getElementById(`${prefix}_cidade`);
    const ufInput = document.getElementById(`${prefix}_uf`);

    if (bairroInput) bairroInput.value = data.bairro || "";
    if (cidadeInput) cidadeInput.value = data.localidade || "";
    if (ufInput) ufInput.value = data.uf || "";

    if (enderecoInput && !enderecoInput.value.trim()) {
      enderecoInput.value = data.logradouro || "";
    }
  } catch (error) {
    console.error("Erro ao buscar CEP:", error);
    alert("Erro ao consultar o CEP.");
  }
}

document.getElementById("f1_cep")?.addEventListener("blur", (event) => buscarCEP(event.target.value, "f1"));
document.getElementById("pagador_cep")?.addEventListener("blur", (event) => buscarCEP(event.target.value, "pagador"));

// ===============================
// PROPONENTES ADICIONAIS
// ===============================
function atualizarOrdemProponentes() {
  const cards = [...document.querySelectorAll(".proponente-card")];

  cards.forEach((card, index) => {
    const number = index + 1;
    card.dataset.index = String(number);
    card.querySelector(".proponente-title").textContent = `Proponente ${number}`;

    card.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      input.id = `proponente_${field}_${number}`;
      input.name = `proponente_${field}_${number}`;
    });

    card.querySelectorAll("label").forEach((label) => {
      const field = label.dataset.field;
      label.setAttribute("for", `proponente_${field}_${number}`);
    });
  });
}

function criarProponenteCard() {
  const totalAtual = document.querySelectorAll(".proponente-card").length;

  // O PDF oficial possui apenas 5 linhas numeradas para proponentes vinculados: 01, 02, 03, 04 e 05.
  // Por isso, o sistema limita o cadastro para evitar que alguém adicione um sexto vinculado que não teria espaço no PDF.
  if (totalAtual >= MAX_PROPONENTES_VINCULADOS) {
    alert("O PDF permite preencher até 5 proponentes vinculados.");
    return;
  }

  const number = totalAtual + 1;
  const card = document.createElement("div");
  card.className = "proponente-card";
  card.dataset.index = String(number);

  card.innerHTML = `
    <div class="proponente-top">
      <span class="proponente-title">Proponente ${number}</span>
      <div class="proponente-actions">
        <button class="btn btn-value valor-pessoa-btn" type="button" disabled>Valor por pessoa: R$ 35,00</button>
        <button type="button" class="btn btn-danger delete-btn" aria-label="Excluir proponente">
          🗑 Excluir
        </button>
      </div>
    </div>

    <div class="grid">
      <div class="field full">
        <label data-field="nome" for="proponente_nome_${number}">Nome:</label>
        <input data-field="nome" type="text" id="proponente_nome_${number}" name="proponente_nome_${number}" />
      </div>

      <div class="field">
        <label data-field="cpf" for="proponente_cpf_${number}">CPF:</label>
        <input data-field="cpf" type="text" id="proponente_cpf_${number}" name="proponente_cpf_${number}" />
      </div>

      <div class="field">
        <label data-field="nascimento" for="proponente_nascimento_${number}">Data de nascimento:</label>
        <input data-field="nascimento" type="date" id="proponente_nascimento_${number}" name="proponente_nascimento_${number}" />
      </div>
    </div>
  `;

  card.querySelector(".delete-btn").addEventListener("click", () => {
    card.remove();
    atualizarOrdemProponentes();
    gerarValorTotal();
  });

  card.querySelector('[data-field="cpf"]')?.addEventListener("input", (event) => {
    event.target.value = formatCPF(event.target.value);
  });

  proponentesContainer?.appendChild(card);
  atualizarOrdemProponentes();
  gerarValorTotal();
}

function getProponentesAdicionais() {
  // Cada card criado na tela representa uma linha numerada no PDF:
  // Proponente 1 -> linha 01, Proponente 2 -> linha 02, e assim por diante até a linha 05.
  // A coleta abaixo usa duas estratégias: primeiro lê os cards visíveis; depois reforça a leitura pelos IDs.
  // Isso evita falhas caso algum navegador altere a ordem do DOM ou algum card seja recriado dinamicamente.
  const proponentes = [];
  const cards = [...document.querySelectorAll(".proponente-card")].slice(0, MAX_PROPONENTES_VINCULADOS);

  cards.forEach((card, index) => {
    const numero = index + 1;
    const nome = card.querySelector('[data-field="nome"]')?.value?.trim() || getFieldValue(`proponente_nome_${numero}`);
    const cpf = card.querySelector('[data-field="cpf"]')?.value?.trim() || getFieldValue(`proponente_cpf_${numero}`);
    const nascimentoRaw = card.querySelector('[data-field="nascimento"]')?.value || getFieldValue(`proponente_nascimento_${numero}`);

    proponentes.push({
      numero,
      nome,
      cpf,
      nascimento: formatDateBR(nascimentoRaw),
      valorPorPessoa: VALOR_POR_PESSOA,
    });
  });

  // Fallback: caso exista input com ID de proponente, mas o card não tenha sido capturado pela classe.
  for (let numero = 1; numero <= MAX_PROPONENTES_VINCULADOS; numero++) {
    const jaExiste = proponentes.some((proponente) => proponente.numero === numero);
    if (jaExiste) continue;

    const nome = getFieldValue(`proponente_nome_${numero}`);
    const cpf = getFieldValue(`proponente_cpf_${numero}`);
    const nascimento = formatDateBR(getFieldValue(`proponente_nascimento_${numero}`));

    if (nome || cpf || nascimento) {
      proponentes.push({
        numero,
        nome,
        cpf,
        nascimento,
        valorPorPessoa: VALOR_POR_PESSOA,
      });
    }
  }

  return proponentes
    .sort((a, b) => a.numero - b.numero)
    .slice(0, MAX_PROPONENTES_VINCULADOS)
    .filter((proponente) => proponente.nome || proponente.cpf || proponente.nascimento);
}

addProponenteBtn?.addEventListener("click", () => {
  criarProponenteCard();
});

// ===============================
// DADOS DO RESPONSÁVEL FINANCEIRO
// ===============================
function copiarDadosProponenteParaPagador() {
  const map = {
    pagador_nome: "f1_nome",
    pagador_rg: "f1_rg",
    pagador_cpf: "f1_cpf",
    pagador_sexo: "f1_sexo",
    pagador_admissao: "f1_admissao",
    pagador_nascimento: "f1_nascimento",
    pagador_tipoSanguineo: "f1_tipoSanguineo",
    pagador_endereco: "f1_endereco",
    pagador_cep: "f1_cep",
    pagador_bairro: "f1_bairro",
    pagador_cidade: "f1_cidade",
    pagador_uf: "f1_uf",
    pagador_telefone: "f1_telefone",
    pagador_email: "f1_email",
    pagador_cargo: "f1_cargo",
    pagador_lotacao: "f1_lotacao",
    pagador_situacaoFuncional: "f1_situacaoFuncional",
  };

  Object.entries(map).forEach(([pagadorId, proponenteId]) => {
    setFieldValue(pagadorId, getFieldValue(proponenteId));
  });
}

function fecharAlertaPagador() {
  document.querySelector(".payer-alert-overlay")?.remove();
}

function mostrarAlertaPagador() {
  if (pagadorAlertShown) return;
  pagadorAlertShown = true;

  const overlay = document.createElement("div");
  overlay.className = "payer-alert-overlay";
  overlay.innerHTML = `
    <div class="payer-alert-card" role="dialog" aria-modal="true">
      <p>Deseja utilizar os mesmos dados já preenchidos?</p>
      <div class="payer-alert-actions">
        <button type="button" class="btn btn-success" id="usarDadosProponenteBtn">Sim</button>
        <button type="button" class="btn btn-danger" id="preencherManualBtn">Não</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("usarDadosProponenteBtn")?.addEventListener("click", () => {
    copiarDadosProponenteParaPagador();
    fecharAlertaPagador();
  });

  document.getElementById("preencherManualBtn")?.addEventListener("click", fecharAlertaPagador);
}

dadosPagadorSection?.addEventListener("focusin", mostrarAlertaPagador);


// ===============================
// FORMA DE PAGAMENTO
// ===============================
function getCheckedValue(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value || "";
}

function atualizarPainelPagamento() {
  const formaSelecionada = getCheckedValue("formaPagamento");

  paymentPanels.forEach((panel) => {
    const isActive = panel.dataset.paymentPanel === formaSelecionada;
    panel.hidden = !isActive;

    if (!isActive) {
      panel.querySelectorAll("input, select, textarea").forEach((field) => {
        if (field.type === "radio" || field.type === "checkbox") field.checked = false;
        else field.value = "";
      });
    }
  });
}

function getFormaPagamento() {
  const forma = getCheckedValue("formaPagamento");

  return {
    forma,
    boleto: {
      melhorDiaPagamento: getCheckedValue("boletoDia"),
    },
    cartaoCredito: {
      nomeImpresso: getFieldValue("cartao_nome"),
      numero: getFieldValue("cartao_numero"),
      validade: getFieldValue("cartao_validade"),
      cvv: getFieldValue("cartao_cvv"),
    },
    debitoConta: {
      tipoConta: getFieldValue("debito_tipo_conta"),
      banco: getFieldValue("debito_banco"),
      agencia: getFieldValue("debito_agencia"),
      conta: getFieldValue("debito_conta"),
    },
    descontoFolha: {
      matricula: getFieldValue("folha_matricula"),
      orgao: getFieldValue("folha_orgao"),
      esfera: getCheckedValue("folha_esfera"),
    },
  };
}

function resetarFormaPagamento() {
  document.querySelectorAll('input[name="formaPagamento"], input[name="boletoDia"], input[name="folha_esfera"]').forEach((field) => {
    field.checked = false;
  });
  paymentPanels.forEach((panel) => {
    panel.hidden = true;
  });
}

formaPagamentoRadios.forEach((radio) => {
  radio.addEventListener("change", atualizarPainelPagamento);
});

// ===============================
// VALOR TOTAL
// ===============================
function calcularValorTotal() {
  const quantidadePessoas = document.querySelectorAll(".valor-pessoa-btn").length;
  return quantidadePessoas * VALOR_POR_PESSOA;
}

function gerarValorTotal() {
  const total = calcularValorTotal();

  if (valorTotalOutput) {
    valorTotalOutput.textContent = formatCurrencyBR(total);
  }

  return total;
}

gerarTotalBtn?.addEventListener("click", gerarValorTotal);

// ===============================
// COLETA DE DADOS
// ===============================
function getFormDataObject() {
  return {
    tipoFormulario: "Formulário 1 - Clube de Benefícios Planos de Saúde",
    enviadoEm: new Date().toISOString(),
    valorPorPessoa: VALOR_POR_PESSOA,
    valorTotal: gerarValorTotal(),
    dadosProponente: {
      nome: getFieldValue("f1_nome"),
      rg: getFieldValue("f1_rg"),
      cpf: getFieldValue("f1_cpf"),
      sexo: getFieldValue("f1_sexo"),
      admissao: formatDateBR(getFieldValue("f1_admissao")),
      nascimento: formatDateBR(getFieldValue("f1_nascimento")),
      tipoSanguineo: getFieldValue("f1_tipoSanguineo"),
      endereco: getFieldValue("f1_endereco"),
      cep: getFieldValue("f1_cep"),
      bairro: getFieldValue("f1_bairro"),
      cidade: getFieldValue("f1_cidade"),
      uf: getFieldValue("f1_uf"),
      telefone: getFieldValue("f1_telefone"),
      email: getFieldValue("f1_email"),
      cargo: getFieldValue("f1_cargo"),
      lotacao: getFieldValue("f1_lotacao"),
      situacaoFuncional: getFieldValue("f1_situacaoFuncional"),
    },
    dadosPagador: {
      nome: getFieldValue("pagador_nome"),
      rg: getFieldValue("pagador_rg"),
      cpf: getFieldValue("pagador_cpf"),
      sexo: getFieldValue("pagador_sexo"),
      admissao: formatDateBR(getFieldValue("pagador_admissao")),
      nascimento: formatDateBR(getFieldValue("pagador_nascimento")),
      tipoSanguineo: getFieldValue("pagador_tipoSanguineo"),
      endereco: getFieldValue("pagador_endereco"),
      cep: getFieldValue("pagador_cep"),
      bairro: getFieldValue("pagador_bairro"),
      cidade: getFieldValue("pagador_cidade"),
      uf: getFieldValue("pagador_uf"),
      telefone: getFieldValue("pagador_telefone"),
      email: getFieldValue("pagador_email"),
      cargo: getFieldValue("pagador_cargo"),
      lotacao: getFieldValue("pagador_lotacao"),
      situacaoFuncional: getFieldValue("pagador_situacaoFuncional"),
    },
    proponentesAdicionais: getProponentesAdicionais(),
    formaPagamento: getFormaPagamento(),
  };
}



// ===============================
// GERAÇÃO DO PDF + ENVIO PARA ASSINAFY
// ===============================
const PDF_MODELO_PATH = "docs/ficha-sindtapp.pdf";
const ASSINAFY_UPLOAD_ENDPOINT = "/api/assinafy-upload";

function limitarTextoPorLargura(text, font, size, maxWidth) {
  let value = String(text || "").trim();
  if (!value) return "";

  while (value.length > 0 && font.widthOfTextAtSize(value, size) > maxWidth) {
    value = value.slice(0, -1);
  }

  return value.length < String(text || "").trim().length && value.length > 1
    ? `${value.slice(0, -1)}…`
    : value;
}

function drawTextInBox(page, text, box, options = {}) {
  if (!text) return;

  const [x, y, width, height] = box;
  const font = options.font;
  const size = options.size || 7.2;
  const paddingX = options.paddingX ?? 3;
  const pageHeight = page.getHeight();
  const maxWidth = width - paddingX * 2;
  const value = limitarTextoPorLargura(text, font, size, maxWidth);

  // As coordenadas abaixo foram mapeadas pelo tamanho real do PDF.
  // O y informado representa a posição visual do topo do campo no PDF renderizado.
  const pdfX = x + paddingX;
  const pdfY = pageHeight - y - height + ((height - size) / 2) + 0.8;

  page.drawText(value, {
    x: pdfX,
    y: pdfY,
    size,
    font,
    color: PDFLib.rgb(0, 0, 0),
  });
}

function drawCheckInBox(page, active, box, font) {
  if (!active) return;

  const [x, y, width, height] = box;
  const pageHeight = page.getHeight();
  const size = 9;

  page.drawText("X", {
    x: x + width / 2 - 3,
    y: pageHeight - y - height + ((height - size) / 2) + 1,
    size,
    font,
    color: PDFLib.rgb(0, 0, 0),
  });
}


async function preencherPdf(payload) {
  if (!window.PDFLib) {
    throw new Error("Biblioteca de PDF não carregada. Verifique sua conexão e tente novamente.");
  }

  const response = await fetch(PDF_MODELO_PATH);
  if (!response.ok) {
    throw new Error("PDF modelo não encontrado na pasta docs.");
  }

  const existingPdfBytes = await response.arrayBuffer();
  const pdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
  const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const page = pdfDoc.getPages()[0];

  const titular = payload.dadosProponente;
  const pagador = payload.dadosPagador;
  const pagamento = payload.formaPagamento;
  const vinculados = payload.proponentesAdicionais.slice(0, 5);
  const totalFormatado = formatCurrencyBR(payload.valorTotal);

  const B = {
    // Coordenadas finais calibradas no PDF otimizado usado em docs/ficha-sindtapp.pdf.
    // Formato: [x, yVisualDoTopo, largura, altura], em pontos PDF.
    // O yVisualDoTopo segue a mesma orientação visual da página renderizada: de cima para baixo.
    titular: {
      nome: [66.0, 108.7, 174.0, 16.7],
      rg: [262.0, 108.7, 50.7, 16.7],
      cpf: [340.0, 108.7, 78.7, 16.7],
      nascimento: [490.0, 108.7, 72.0, 19.3],
      sexo: [61.3, 131.3, 107.3, 18.0],
      tipoSanguineo: [247.3, 132.7, 65.3, 18.0],
      admissao: [402.7, 132.0, 104.0, 18.7],
      telefone: [134.7, 153.3, 106.0, 17.3],
      email: [274.0, 153.3, 233.3, 18.7],
      endereco: [81.3, 177.3, 160.7, 16.7],
      cidade: [280.0, 176.0, 67.3, 18.7],
      uf: [368.7, 176.7, 48.7, 18.0],
      cep: [444.0, 176.0, 116.0, 18.0],
      cargo: [64.0, 195.3, 108.0, 16.0],
      lotacao: [214.0, 195.3, 98.7, 16.0],
      situacaoFuncional: [386.7, 195.3, 123.3, 16.0],
    },
    pagador: {
      nome: [66.0, 241.3, 176.0, 17.3],
      rg: [263.3, 242.0, 48.0, 16.7],
      cpf: [338.7, 243.3, 79.3, 15.3],
      nascimento: [488.7, 243.3, 76.0, 17.3],
      sexo: [60.0, 265.3, 112.0, 15.3],
      tipoSanguineo: [248.0, 266.7, 63.3, 16.7],
      admissao: [402.7, 266.0, 108.7, 17.3],
      telefone: [132.0, 288.0, 108.7, 16.0],
      email: [274.0, 287.3, 237.3, 16.7],
      endereco: [80.7, 308.7, 160.0, 17.3],
      cidade: [279.3, 308.0, 69.3, 18.0],
      uf: [370.0, 308.0, 48.7, 17.3],
      cep: [445.3, 308.0, 120.0, 17.3],
      cargo: [66.0, 332.0, 104.0, 14.0],
      lotacao: [216.0, 333.3, 96.7, 12.0],
      situacaoFuncional: [386.7, 331.3, 126.0, 14.0],
    },
    vinculados: [
      { nome: [62.7, 388.0, 215.3, 16.7], cpf: [302.0, 388.0, 116.0, 17.3], nascimento: [487.3, 388.0, 84.7, 17.3] },
      { nome: [63.3, 423.3, 214.7, 18.0], cpf: [304.0, 422.0, 116.0, 19.3], nascimento: [486.0, 422.7, 86.0, 18.7] },
      { nome: [63.3, 460.7, 215.3, 16.7], cpf: [302.0, 460.7, 117.3, 18.0], nascimento: [487.3, 460.0, 84.7, 19.3] },
      { nome: [64.0, 497.3, 214.0, 16.7], cpf: [303.3, 496.7, 115.3, 16.0], nascimento: [487.3, 498.0, 84.0, 14.7] },
      { nome: [62.7, 532.0, 215.3, 16.0], cpf: [303.3, 530.7, 116.7, 17.3], nascimento: [488.7, 532.0, 82.7, 16.0] },
    ],
    pagamento: {
      total: [307.0, 561.0, 90.0, 14.0],
      boleto: [72.7, 579.3, 17.3, 14.0],
      boleto5: [129.3, 579.3, 18.0, 15.3],
      boleto10: [204.7, 580.7, 22.0, 14.0],
      boleto15: [275.3, 580.0, 22.7, 13.3],
      boleto20: [345.3, 578.7, 21.3, 14.7],
      cartao: [131.3, 601.3, 17.3, 15.3],
      cartaoNome: [192.7, 602.0, 101.3, 15.3],
      cartaoNumero: [312.7, 601.3, 86.7, 16.0],
      cartaoValidade: [444.7, 600.0, 54.0, 17.3],
      cartaoCvv: [523.3, 600.0, 51.3, 16.7],
      debito: [122.7, 622.7, 15.3, 15.3],
      debitoTipo: [218.7, 623.3, 66.0, 14.7],
      debitoBanco: [320.7, 623.3, 71.3, 14.7],
      debitoAgencia: [435.3, 623.3, 50.7, 16.0],
      debitoConta: [503.3, 623.3, 72.0, 16.0],
      folha: [140.7, 648.0, 14.7, 12.7],
      folhaMatricula: [230.0, 646.0, 79.3, 15.3],
      folhaOrgao: [344.7, 646.0, 88.0, 16.7],
      folhaEsfera: [468.0, 646.7, 108.0, 16.7],
    },
  };

  const drawPerson = (data, boxes) => {
    drawTextInBox(page, data.nome, boxes.nome, { font, size: 7.2 });
    drawTextInBox(page, data.rg, boxes.rg, { font, size: 7.2 });
    drawTextInBox(page, data.cpf, boxes.cpf, { font, size: 7.2 });
    drawTextInBox(page, data.nascimento, boxes.nascimento, { font, size: 7.2 });
    drawTextInBox(page, data.sexo, boxes.sexo, { font, size: 7.2 });
    drawTextInBox(page, data.tipoSanguineo, boxes.tipoSanguineo, { font, size: 7.2 });
    drawTextInBox(page, data.admissao, boxes.admissao, { font, size: 7.2 });
    drawTextInBox(page, data.telefone, boxes.telefone, { font, size: 7.2 });
    drawTextInBox(page, data.email, boxes.email, { font, size: 7.2 });
    drawTextInBox(page, data.endereco, boxes.endereco, { font, size: 7.2 });
    drawTextInBox(page, data.cidade, boxes.cidade, { font, size: 7.2 });
    drawTextInBox(page, data.uf, boxes.uf, { font, size: 7.2 });
    drawTextInBox(page, data.cep, boxes.cep, { font, size: 7.2 });
    drawTextInBox(page, data.cargo, boxes.cargo, { font, size: 7.2 });
    drawTextInBox(page, data.lotacao, boxes.lotacao, { font, size: 7.2 });
    drawTextInBox(page, data.situacaoFuncional, boxes.situacaoFuncional, { font, size: 7.2 });
  };

  drawPerson(titular, B.titular);
  drawPerson(pagador, B.pagador);

  vinculados.forEach((item, index) => {
    // Preenchimento fiel à numeração visual do PDF.
    // Linha 01 recebe o primeiro proponente capturado, linha 02 recebe o segundo, até a linha 05.
    // Se o objeto vier com numero explícito, ele é respeitado; se não vier, usa o índice como segurança.
    const linhaPdf = Number(item.numero || index + 1);
    const boxes = B.vinculados[linhaPdf - 1] || B.vinculados[index];
    if (!boxes) return;

    drawTextInBox(page, item.nome, boxes.nome, { font, size: 7.2 });
    drawTextInBox(page, item.cpf, boxes.cpf, { font, size: 7.2 });
    drawTextInBox(page, item.nascimento, boxes.nascimento, { font, size: 7.2 });
  });

  drawTextInBox(page, totalFormatado, B.pagamento.total, { font: fontBold, size: 7.2 });

  drawCheckInBox(page, pagamento.forma === "boleto", B.pagamento.boleto, fontBold);
  drawCheckInBox(page, pagamento.boleto.melhorDiaPagamento === "5", B.pagamento.boleto5, fontBold);
  drawCheckInBox(page, pagamento.boleto.melhorDiaPagamento === "10", B.pagamento.boleto10, fontBold);
  drawCheckInBox(page, pagamento.boleto.melhorDiaPagamento === "15", B.pagamento.boleto15, fontBold);
  drawCheckInBox(page, pagamento.boleto.melhorDiaPagamento === "20", B.pagamento.boleto20, fontBold);

  drawCheckInBox(page, pagamento.forma === "cartao_credito", B.pagamento.cartao, fontBold);
  drawTextInBox(page, pagamento.cartaoCredito.nomeImpresso, B.pagamento.cartaoNome, { font, size: 7 });
  drawTextInBox(page, pagamento.cartaoCredito.numero, B.pagamento.cartaoNumero, { font, size: 7 });
  drawTextInBox(page, pagamento.cartaoCredito.validade, B.pagamento.cartaoValidade, { font, size: 7 });
  drawTextInBox(page, pagamento.cartaoCredito.cvv, B.pagamento.cartaoCvv, { font, size: 7 });

  drawCheckInBox(page, pagamento.forma === "debito_conta", B.pagamento.debito, fontBold);
  drawTextInBox(page, pagamento.debitoConta.tipoConta, B.pagamento.debitoTipo, { font, size: 7 });
  drawTextInBox(page, pagamento.debitoConta.banco, B.pagamento.debitoBanco, { font, size: 7 });
  drawTextInBox(page, pagamento.debitoConta.agencia, B.pagamento.debitoAgencia, { font, size: 7 });
  drawTextInBox(page, pagamento.debitoConta.conta, B.pagamento.debitoConta, { font, size: 7 });

  drawCheckInBox(page, pagamento.forma === "desconto_folha", B.pagamento.folha, fontBold);
  drawTextInBox(page, pagamento.descontoFolha.matricula, B.pagamento.folhaMatricula, { font, size: 7 });
  drawTextInBox(page, pagamento.descontoFolha.orgao, B.pagamento.folhaOrgao, { font, size: 7 });
  drawTextInBox(page, pagamento.descontoFolha.esfera, B.pagamento.folhaEsfera, { font, size: 7 });


  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function enviarPdfParaAssinafy(pdfBlob, filename, payload) {
  const formData = new FormData();
  formData.append("file", pdfBlob, filename);

  // Estes dados não vão para o usuário final agora; ficam salvos no backend
  // vinculados ao documentId da Assinafy. Quando o webhook avisar que o documento
  // foi assinado por todos, o backend usa este mesmo e-mail para enviar o PDF final.
  formData.append("recipientEmail", payload.dadosProponente.email);
  formData.append("recipientName", payload.dadosProponente.nome);
  formData.append("proponenteCpf", payload.dadosProponente.cpf);
  formData.append("proponenteNascimento", payload.dadosProponente.nascimento);
  formData.append("documentName", filename);

  const response = await fetch(ASSINAFY_UPLOAD_ENDPOINT, {
    method: "POST",
    body: formData,
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.message || "Não foi possível enviar o PDF para a Assinafy.");
  }

  return result;
}


async function iniciarAssinaturaAssinafyComRetry(documentId) {
  if (!documentId) {
    throw new Error("Documento criado, mas o ID não foi retornado pela Assinafy.");
  }

  const maxTentativas = 12;
  const intervaloMs = 4000;
  let ultimoResultado = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const startBody = window.__ultimoPayloadAssinafy || {};
    const proponente = startBody.dadosProponente || {};

    const response = await fetch(`/api/start-assignment?documentId=${encodeURIComponent(documentId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentId,
        proponenteEmail: proponente.email,
        proponenteName: proponente.nome,
        proponenteCpf: proponente.cpf,
        proponenteNascimento: proponente.nascimento,
        recipientEmail: proponente.email,
        recipientName: proponente.nome,
        documentName: window.__ultimoFilenameAssinafy || "ficha-sindtapp.pdf",
      }),
    });

    const result = await response.json().catch(() => ({}));
    ultimoResultado = result;

    if (response.ok && result.assignmentCreated) {
      return result;
    }

    if (response.status !== 202 && !response.ok) {
      throw new Error(result.message || "Não foi possível iniciar a assinatura na Assinafy.");
    }

    if (submitBtn) {
      submitBtn.textContent = `Aguardando Assinafy... (${tentativa}/${maxTentativas})`;
    }

    await new Promise((resolve) => setTimeout(resolve, intervaloMs));
  }

  throw new Error(
    ultimoResultado?.message ||
      "O documento foi criado, mas a Assinafy ainda está processando. Tente iniciar a assinatura novamente em alguns segundos."
  );
}

async function processarEnvio(event) {
  event.preventDefault();

  if (!form1.checkValidity()) {
    form1.reportValidity();
    return;
  }

  const payload = getFormDataObject();
  const filename = `ficha-${slugify(payload.dadosProponente.nome)}.pdf`;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Gerando PDF...";
    }

    const pdfBlob = await preencherPdf(payload);

    // A Vercel bloqueia requests para Functions acima de aproximadamente 4.5 MB.
    // Mantemos o modelo PDF otimizado e validamos antes do upload para evitar erro 413/FUNCTION_PAYLOAD_TOO_LARGE.
    const limiteVercelBytes = 4.2 * 1024 * 1024;
    if (pdfBlob.size > limiteVercelBytes) {
      throw new Error(
        `O PDF gerado ficou muito pesado (${(pdfBlob.size / 1024 / 1024).toFixed(2)} MB). ` +
          "O modelo precisa continuar otimizado para ser enviado pela Vercel."
      );
    }

    if (submitBtn) submitBtn.textContent = "Enviando para Assinafy...";
    window.__ultimoPayloadAssinafy = payload;
    window.__ultimoFilenameAssinafy = filename;
    const resultadoAssinafy = await enviarPdfParaAssinafy(pdfBlob, filename, payload);

    if (submitBtn) submitBtn.textContent = "Aguardando processamento da Assinafy...";
    await iniciarAssinaturaAssinafyComRetry(resultadoAssinafy.documentId);

    alert("Documento gerado na Assinafy e enviado para 2 signatários: PROPONENTE e SINDICATO. Quando todos assinarem, os 2 e-mails finais configurados receberão o documento assinado com a autenticidade da Assinafy.");
  } catch (error) {
    console.error("Erro no envio do formulário:", error);
    alert(error.message || "Erro ao gerar/enviar o PDF. Tente novamente.");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Enviar formulário";
    }
  }
}

form1?.addEventListener("submit", processarEnvio);

// ===============================
// INICIALIZAÇÃO
// ===============================
window.addEventListener("load", () => {
  if (proponentesContainer) proponentesContainer.innerHTML = "";
  gerarValorTotal();
  resetarFormaPagamento();
  atualizarStatusAssinatura();
});