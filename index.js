require('dotenv').config();

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const db = require('./database');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { createCanvas } = require('canvas');
const { Chart, registerables } = require('chart.js');

// Registrar todos os componentes do Chart.js
Chart.register(...registerables);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const MEU_NUMERO_PESSOAL = process.env.MEU_NUMERO_PESSOAL;
const MEU_ID_MASCARADO = process.env.MEU_ID_MASCARADO;

const openai = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
});

// ========== FUNÇÕES AUXILIARES PARA GERAR ARQUIVOS ==========

// 1. Gerar Planilha Excel
async function gerarExcel(listaGastos, titulo) {
    console.log('📊 Gerando planilha Excel...');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Relatório de Gastos');

    worksheet.columns = [
        { header: 'Data', key: 'data_formatada', width: 15 },
        { header: 'Local', key: 'nome', width: 30 },
        { header: 'Categoria', key: 'tipo', width: 20 },
        { header: 'Valor (R$)', key: 'valor', width: 15 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2196F3' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
    headerRow.height = 25;

    listaGastos.forEach((gasto, index) => {
        const row = worksheet.addRow({
            data_formatada: gasto.data_formatada,
            nome: gasto.nome,
            tipo: gasto.tipo,
            valor: Number(gasto.valor).toFixed(2)
        });

        if (index % 2 === 0) {
            row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
        }
    });

    const totalValor = listaGastos.reduce((soma, g) => soma + Number(g.valor), 0);
    const totalRow = worksheet.addRow({
        data_formatada: '',
        nome: 'TOTAL',
        tipo: '',
        valor: totalValor.toFixed(2)
    });
    totalRow.font = { bold: true, size: 12 };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2FD' } };
    totalRow.border = {
        top: { style: 'thick', color: { argb: 'FF2196F3' } },
        bottom: { style: 'thick', color: { argb: 'FF2196F3' } }
    };

    worksheet.eachRow((row) => {
        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    console.log('✅ Planilha Excel gerada!');
    return Buffer.from(buffer);
}

// 2. Gerar PDF
async function gerarPDF(listaGastos, titulo) {
    console.log('📄 Gerando PDF...');
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'portrait' });
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => {
                console.log('✅ PDF gerado!');
                resolve(Buffer.concat(chunks));
            });
            doc.on('error', reject);

            // Título
            doc.fontSize(22).font('Helvetica-Bold').fillColor('#2196F3').text(titulo, { align: 'center' });
            doc.moveDown(2);

            // Linha decorativa
            doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#2196F3').lineWidth(2).stroke();
            doc.moveDown(2);

            // Cabeçalho da tabela
            const startX = 50;
            let y = doc.y;
            const colWidths = [70, 170, 90, 90];
            const headers = ['Data', 'Local', 'Categoria', 'Valor'];

            doc.rect(startX, y - 5, colWidths.reduce((a, b) => a + b, 0), 25).fill('#2196F3');
            doc.fontSize(12).font('Helvetica-Bold').fillColor('#FFFFFF');

            headers.forEach((header, i) => {
                doc.text(header, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, {
                    width: colWidths[i], align: 'center'
                });
            });

            y += 30;

            // Dados da tabela
            doc.font('Helvetica').fontSize(10).fillColor('#333333');

            listaGastos.forEach((gasto, index) => {
                if (index % 2 === 0) {
                    doc.rect(startX, y - 5, colWidths.reduce((a, b) => a + b, 0), 20).fill('#F5F5F5');
                }

                const rowData = [
                    gasto.data_formatada,
                    gasto.nome.length > 25 ? gasto.nome.substring(0, 22) + '...' : gasto.nome,
                    gasto.tipo,
                    `R$ ${Number(gasto.valor).toFixed(2)}`
                ];

                doc.fillColor('#333333');
                rowData.forEach((data, i) => {
                    doc.text(data, startX + colWidths.slice(0, i).reduce((a, b) => a + b, 0), y, {
                        width: colWidths[i], align: i === 3 ? 'right' : 'left'
                    });
                });

                y += 22;

                if (y > 750) {
                    doc.addPage();
                    y = 50;
                }
            });

            // Linha antes do total
            y += 5;
            doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y)
               .strokeColor('#2196F3').lineWidth(1).stroke();
            y += 15;

            // Total
            const total = listaGastos.reduce((soma, g) => soma + Number(g.valor), 0);
            doc.fontSize(14).font('Helvetica-Bold').fillColor('#2196F3')
               .text(`Total Acumulado: R$ ${total.toFixed(2)}`, startX, y, {
                   width: colWidths.reduce((a, b) => a + b, 0), align: 'right'
               });

            // Rodapé
            doc.fontSize(8).font('Helvetica').fillColor('#999999')
               .text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}`,
                   50, 780, { align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

// 3. Gerar Gráfico de Pizza
async function gerarGrafico(dadosAgrupados, titulo) {
    console.log('📈 Gerando gráfico de pizza...');
    try {
        const width = 800;
        const height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const labels = dadosAgrupados.map(d => d.tipo.charAt(0).toUpperCase() + d.tipo.slice(1));
        const valores = dadosAgrupados.map(d => Number(d.total));

        const cores = [
            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0',
            '#9966FF', '#FF9F40', '#8BC34A', '#E91E63',
            '#00BCD4', '#FF5722', '#795548', '#607D8B'
        ];

        const chart = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: labels,
                datasets: [{
                    data: valores,
                    backgroundColor: cores.slice(0, labels.length),
                    borderWidth: 3,
                    borderColor: '#FFFFFF',
                    hoverBorderWidth: 4,
                    hoverBorderColor: '#000000'
                }]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: titulo,
                        font: { size: 22, weight: 'bold', family: 'Arial' },
                        padding: 20,
                        color: '#333333'
                    },
                    legend: {
                        position: 'bottom',
                        labels: { font: { size: 14 }, padding: 20, usePointStyle: true }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                                const percent = ((ctx.raw / total) * 100).toFixed(1);
                                return `${ctx.label}: R$ ${ctx.raw.toFixed(2)} (${percent}%)`;
                            }
                        }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        console.log('✅ Gráfico de pizza gerado!');
        return buffer;
    } catch (error) {
        console.error('❌ Erro ao gerar gráfico:', error);
        throw error;
    }
}

// 4. Gerar Gráfico de Barras
async function gerarGraficoBarras(dadosAgrupados, titulo) {
    console.log('📊 Gerando gráfico de barras...');
    try {
        const width = 800;
        const height = 500;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        const labels = dadosAgrupados.map(d => d.tipo.charAt(0).toUpperCase() + d.tipo.slice(1));
        const valores = dadosAgrupados.map(d => Number(d.total));

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Total Gasto (R$)',
                    data: valores,
                    backgroundColor: '#36A2EB',
                    borderColor: '#2196F3',
                    borderWidth: 2,
                    borderRadius: 5,
                    borderSkipped: false
                }]
            },
            options: {
                responsive: false,
                animation: false,
                plugins: {
                    title: {
                        display: true,
                        text: titulo,
                        font: { size: 20, weight: 'bold' },
                        padding: 20
                    },
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: (value) => `R$ ${value}` }
                    }
                }
            }
        });

        const buffer = canvas.toBuffer('image/png');
        chart.destroy();
        console.log('✅ Gráfico de barras gerado!');
        return buffer;
    } catch (error) {
        console.error('❌ Erro ao gerar gráfico de barras:', error);
        throw error;
    }
}

// ========== INICIALIZAÇÃO DO CLIENT ==========

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('📱 QR Code gerado! Escaneie com seu WhatsApp.');
});

client.on('ready', () => {
    console.log('🚀 Assistente de gastos com relatórios (Excel/PDF/Gráficos) ONLINE!');
    console.log('📊 Funcionalidades disponíveis:');
    console.log('   - Registrar gastos');
    console.log('   - Consultar relatórios (texto)');
    console.log('   - Gerar planilhas Excel');
    console.log('   - Gerar PDFs');
    console.log('   - Gerar gráficos (pizza e barras)');
});

client.on('message', async (msg) => {
    console.log(`\n[WhatsApp]: Mensagem de ${msg.from}`);
    console.log(`[Texto]: ${msg.body}`);

    if (msg.from === MEU_NUMERO_PESSOAL || msg.from === MEU_ID_MASCARADO) {
        try {
            if (msg.hasMedia || msg.type !== 'chat') {
                console.log('[Aviso]: Mídia ou Áudio detectado. Ignorando.');
                await msg.reply('🎙️ Por enquanto eu só entendo texto escrito, Leo! Digita aí para mim.');
                return;
            }

            const chat = await msg.getChat();
            await chat.sendStateTyping();

            const promptDoSistema =
                "Você é o assistente financeiro do Leo, um cara gente boa e descontraído. Analise a mensagem dele e decida:\n" +
                "1. Se ele quer REGISTRAR um gasto: defina 'eGasto' como true e extraia:\n" +
                "   - nome: o local do gasto (em minúsculas).\n" +
                "   - tipo: a categoria MAIS ADEQUADA (use termos como 'saude', 'alimentacao', 'transporte', 'lazer', 'mercado', 'moradia'). Se não for nenhuma dessas, crie uma categoria lógica nova.\n" +
                "   - valor: o valor numérico.\n" +
                "   - data: se o usuário mencionou uma data específica (ex: 'dia 27/05', '27/05', '27 de maio'), converta-a para o formato 'YYYY-MM-DD'. O ano atual é 2026. Se não houver ano na mensagem, use 2026. Se houver ano explícito (ex: '27/05/2025'), respeite-o. Se não houver data na mensagem, retorne null.\n" +
                "2. Se ele quer CONSULTAR relatórios: defina 'eConsulta' como true e extraia opcionalmente:\n" +
                "   - categoriaConsulta: a categoria que ele quer filtrar (ou null/'todos' para todas).\n" +
                "   - mesConsulta: número do mês (1 a 12) se ele mencionar um mês específico (ex: 'abril', 'mês 4', 'relatório de maio', 'mês passado', 'último mês'). Se ele falar 'mês passado', 'último mês', 'mês anterior', calcule o mês anterior ao atual (atual é 6/junho, então mês passado é 5/maio). Se não mencionar mês, retorne null.\n" +
                "   - anoConsulta: ano do mês (ex: 2026). Se não mencionar ano, assuma o ano atual 2026. Se ele falar 'mês passado' e o mês atual for janeiro, o ano deve ser 2025. Se não houver mês, retorne null.\n" +
                "   - gerarExcel: true se ele pedir planilha, Excel, 'xls', 'arquivo Excel' ou 'documento Excel'.\n" +
                "   - gerarPDF: true se ele pedir PDF, 'documento PDF' ou 'arquivo PDF'.\n" +
                "   - gerarGrafico: true se ele pedir gráfico, imagem, 'visual', 'gráfico de pizza', 'gráfico de barras', 'dashboard' ou 'visualização'.\n" +
                "   - tipoGrafico: 'pizza' se pedir gráfico de pizza/torta, 'barras' se pedir gráfico de barras/colunas. Padrão: 'pizza'.\n" +
                "3. Se ele quer APAGAR um gasto específico: defina 'eExclusao' como true e extraia nome e valor.\n" +
                "4. Se ele quer APAGAR TODOS os gastos: defina 'eExclusaoTotal' como true.\n" +
                "5. Se for conversa normal: defina TODOS os booleanos como false e preencha 'respostaConversa'.\n" +
                "Importante: Farmácia é 'saude'. Padaria é 'alimentacao'. Posto de gasolina é 'transporte'.\n" +
                "Responda APENAS com um objeto JSON contendo: eGasto, eConsulta, eExclusao, eExclusaoTotal, nome, tipo, valor, data, categoriaConsulta, mesConsulta, anoConsulta, gerarExcel, gerarPDF, gerarGrafico, tipoGrafico, respostaConversa.";

            console.log('[IA]: Enviando mensagem para análise...');
            const response = await openai.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: promptDoSistema },
                    { role: "user", content: msg.body }
                ],
                response_format: { type: "json_object" },
                temperature: 0.3,
                max_tokens: 500
            });

            let analiseIA;
            try {
                const respostaBruta = response.choices[0].message.content;
                console.log('[IA]: Resposta bruta:', respostaBruta);
                analiseIA = JSON.parse(respostaBruta);
                console.log('[IA]: Análise concluída:', JSON.stringify(analiseIA, null, 2));
            } catch (e) {
                console.error('[Erro]: Falha ao converter resposta da IA:', e);
                await msg.reply("🤖 Leo, o cérebro da IA deu um nó aqui. Pode repetir a mensagem?");
                return;
            }

            // 🔀 FLUXO 1: Cadastrar Gasto
            if (analiseIA.eGasto) {
                console.log('[Ação]: Registrando novo gasto...');
                const nomeGasto = analiseIA.nome.toLowerCase().trim();
                const categoriaGasto = analiseIA.tipo.toLowerCase().trim();
                const dataGasto = analiseIA.data || null;

                await db.salvarGasto(msg.from, nomeGasto, categoriaGasto, analiseIA.valor, dataGasto);

                let dataFormatada = 'Data atual';
                if (dataGasto) {
                    const [ano, mes, dia] = dataGasto.split('-');
                    dataFormatada = `${dia}/${mes}/${ano}`;
                }

                console.log(`[Sucesso]: Gasto registrado - ${nomeGasto} | R$ ${analiseIA.valor} | ${categoriaGasto}`);
                await msg.reply(
                    `💰 *Gasto Anotado!*\n\n` +
                    `📌 *Local:* ${nomeGasto}\n` +
                    `📂 *Categoria:* ${categoriaGasto}\n` +
                    `💵 *Valor:* R$ ${Number(analiseIA.valor).toFixed(2)}\n` +
                    `📅 *Data:* ${dataFormatada}\n\n` +
                    `_✅ Salvo com sucesso no MariaDB!_`
                );
            }

            // 🔀 FLUXO 2: Consultar Relatório
            else if (analiseIA.eConsulta) {
                console.log('[Ação]: Gerando relatório...');
                const categoria = analiseIA.categoriaConsulta || null;
                const mes = analiseIA.mesConsulta || null;
                const ano = mes ? (analiseIA.anoConsulta || 2026) : null;

                const listaGastos = await db.puxarGastos(msg.from, categoria, mes, ano);

                let descricaoPeriodo = '';
                let nomeMesArquivo = '';
                if (mes && ano) {
                    const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' });
                    descricaoPeriodo = `do mês de ${nomeMes} de ${ano}`;
                    nomeMesArquivo = `${ano}_${String(mes).padStart(2, '0')}`;
                } else {
                    nomeMesArquivo = 'geral';
                }

                if (listaGastos.length === 0) {
                    const msgErro = descricaoPeriodo
                        ? `📊 Nenhum gasto encontrado ${descricaoPeriodo}, Leo!`
                        : "📊 Não encontrei nenhum gasto registrado nessa categoria, Leo!";
                    console.log('[Aviso]: Nenhum gasto encontrado');
                    await msg.reply(msgErro);
                    return;
                }

                const totalGeral = listaGastos.reduce((soma, item) => soma + Number(item.valor), 0);
                console.log(`[Dados]: ${listaGastos.length} gastos | Total: R$ ${totalGeral.toFixed(2)}`);

                // Gerar Excel
                if (analiseIA.gerarExcel) {
                    console.log('[Ação]: Gerando planilha Excel...');
                    await chat.sendStateTyping();
                    const excelBuffer = await gerarExcel(listaGastos, `Relatório de Gastos ${descricaoPeriodo || 'Geral'}`);
                    const media = new MessageMedia(
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        excelBuffer.toString('base64'),
                        `gastos_${nomeMesArquivo}.xlsx`
                    );
                    await chat.sendMessage(media);
                    await msg.reply(`📊 *Planilha Excel gerada!*\n\nTotal: *R$ ${totalGeral.toFixed(2)}*\nPeríodo: ${descricaoPeriodo || 'Todos'}`);
                    console.log('[Sucesso]: Planilha enviada!');
                    return;
                }

                // Gerar PDF
                if (analiseIA.gerarPDF) {
                    console.log('[Ação]: Gerando PDF...');
                    await chat.sendStateTyping();
                    const pdfBuffer = await gerarPDF(listaGastos, `Relatório de Gastos ${descricaoPeriodo || 'Geral'}`);
                    const media = new MessageMedia(
                        'application/pdf',
                        pdfBuffer.toString('base64'),
                        `gastos_${nomeMesArquivo}.pdf`
                    );
                    await chat.sendMessage(media);
                    await msg.reply(`📄 *PDF gerado com sucesso!*\n\nTotal: *R$ ${totalGeral.toFixed(2)}*\nPeríodo: ${descricaoPeriodo || 'Todos'}`);
                    console.log('[Sucesso]: PDF enviado!');
                    return;
                }

                // Gerar Gráfico
                if (analiseIA.gerarGrafico) {
                    console.log('[Ação]: Gerando gráfico...');
                    await chat.sendStateTyping();
                    const dadosAgrupados = await db.puxarGastosAgrupados(msg.from, mes, ano);

                    const tipoGrafico = analiseIA.tipoGrafico || 'pizza';
                    let graficoBuffer;

                    if (tipoGrafico === 'barras') {
                        graficoBuffer = await gerarGraficoBarras(dadosAgrupados, `Gastos por Categoria ${descricaoPeriodo || 'Geral'}`);
                    } else {
                        graficoBuffer = await gerarGrafico(dadosAgrupados, `Distribuição de Gastos ${descricaoPeriodo || 'Geral'}`);
                    }

                    const media = new MessageMedia(
                        'image/png',
                        graficoBuffer.toString('base64'),
                        `grafico_${nomeMesArquivo}.png`
                    );
                    await chat.sendMessage(media);
                    await msg.reply(`📈 *Gráfico gerado com sucesso!*\n\nTotal: *R$ ${totalGeral.toFixed(2)}*\nPeríodo: ${descricaoPeriodo || 'Todos'}`);
                    console.log('[Sucesso]: Gráfico enviado!');
                    return;
                }

                // Relatório texto normal
                console.log('[Ação]: Gerando relatório texto...');
                const promptRelatorio =
                    `O usuário Leo solicitou um relatório financeiro ${descricaoPeriodo ? descricaoPeriodo : 'geral'}.\n` +
                    `Dados do MariaDB (ordenados do mais antigo para o mais novo):\n` +
                    `${JSON.stringify(listaGastos)}\n` +
                    `Total acumulado: R$ ${totalGeral.toFixed(2)}.\n\n` +
                    `Monte uma mensagem de relatório amigável e organizada para WhatsApp. Para cada item, mostre data_formatada, tipo, nome e valor. No final, destaque o Total em negrito.`;

                const respostaFinalRelatorio = await openai.chat.completions.create({
                    model: "llama-3.3-70b-versatile",
                    messages: [{ role: "user", content: promptRelatorio }]
                });

                await msg.reply(respostaFinalRelatorio.choices[0].message.content);
            }

            // 🔀 FLUXO 3: Deletar Gasto Específico
            else if (analiseIA.eExclusao) {
                const nomeAlvo = analiseIA.nome.toLowerCase().trim();
                const linhasApagadas = await db.deletarGasto(msg.from, nomeAlvo, analiseIA.valor);

                if (linhasApagadas > 0) {
                    await msg.reply(`🗑️ *Gasto Removido!*\n\nDeletei o gasto de *R$ ${Number(analiseIA.valor).toFixed(2)}* no *${nomeAlvo}*!`);
                } else {
                    await msg.reply(`📊 Não achei nenhum gasto de *R$ ${Number(analiseIA.valor).toFixed(2)}* no *${nomeAlvo}* para apagar.`);
                }
            }

            // 🔀 FLUXO 4: Deletar TODOS os gastos
            else if (analiseIA.eExclusaoTotal) {
                const linhasApagadas = await db.deletarTodosGastos(msg.from);
                if (linhasApagadas > 0) {
                    await msg.reply(`🗑️ *Todos os gastos foram removidos!* ${linhasApagadas} registro(s) apagado(s).`);
                } else {
                    await msg.reply(`📊 Não havia nenhum gasto registrado para apagar, Leo.`);
                }
            }

            // 🔀 FLUXO 5: Conversa normal
            else {
                if (analiseIA.respostaConversa) {
                    await msg.reply(analiseIA.respostaConversa);
                } else {
                    try {
                        const respostaFallback = await openai.chat.completions.create({
                            model: "llama-3.3-70b-versatile",
                            messages: [
                                { role: "system", content: "Você é o assistente financeiro do Leo. Responda de forma natural, engraçada e amigável. Use emojis. Seja descontraído." },
                                { role: "user", content: msg.body }
                            ]
                        });
                        await msg.reply(respostaFallback.choices[0].message.content);
                    } catch (e) {
                        const respostasPadrao = [
                            "Fala, Leo! Tudo bem? Como posso ajudar com suas finanças hoje? 😊",
                            "E aí, chefia! Quer registrar um gasto ou dar uma olhada no relatório? 📊",
                            "Opa, Leo! Tô aqui pra te ajudar a controlar a grana. O que você precisa? 💰",
                            "Salve, mestre! Já anotou os gastos de hoje? Posso te ajudar com isso! ✍️",
                            "Fala, patrão! Se quiser, pode falar 'registrar' ou 'relatório' que eu te ajudo! 🚀",
                            "Tô ouvindo, Leo! Pode falar sobre gastos, relatórios ou só bater um papo! 😄",
                            "E aí, meu querido! Como estão as finanças hoje? Posso dar uma força! 💪"
                        ];
                        const respostaAleatoria = respostasPadrao[Math.floor(Math.random() * respostasPadrao.length)];
                        await msg.reply(respostaAleatoria);
                    }
                }
            }

        } catch (error) {
            console.error('❌ Erro no processamento:', error);
            const mensagensErro = [
                "Ops, Leo! Deu um probleminha técnico aqui. Pode tentar de novo? 🔧",
                "Erro interno, chefia! Tenta repetir a mensagem que eu resolvo. 💻",
                "Deu pau no sistema, Leo! Manda de novo que eu tô pronto! 🚀"
            ];
            await msg.reply(mensagensErro[Math.floor(Math.random() * mensagensErro.length)]);
        }
    }
});

client.initialize();