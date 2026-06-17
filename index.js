require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require('openai');
const db = require('./database'); 

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const MEU_NUMERO_PESSOAL = process.env.MEU_NUMERO_PESSOAL;
const MEU_ID_MASCARADO   = process.env.MEU_ID_MASCARADO;

const openai = new OpenAI({
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: process.env.GROQ_API_KEY,
});

client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🚀 O seu assistente de gastos (Groq Free) está online!');
});

client.on('message', async (msg) => {
    console.log(`[WhatsApp]: Mensagem de ${msg.from} | Texto: ${msg.body}`);

    if (msg.from === MEU_NUMERO_PESSOAL || msg.from === MEU_ID_MASCARADO) {
        try {
            if (msg.hasMedia || msg.type !== 'chat') {
                console.log(`[Aviso]: Mídia ou Áudio detectado. Ignorando.`);
                await msg.reply('🎙️ Por enquanto eu só entendo texto escrito, Leo! Digita aí para mim.');
                return;
            }

            const chat = await msg.getChat();
            await chat.sendStateTyping();

            // Prompt do sistema ATUALIZADO com melhorias para conversas
            const promptDoSistema = 
                "Você é o assistente financeiro do Leo, um cara gente boa e descontraído. Analise a mensagem dele e decida:\n" +
                "1. Se ele quer REGISTRAR um gasto: defina 'eGasto' como true e extraia:\n" +
                "   - nome: o local do gasto (em minúsculas).\n" +
                "   - tipo: a categoria MAIS ADEQUADA (use termos como 'saude', 'alimentacao', 'transporte', 'lazer', 'mercado', 'moradia'). Se não for nenhuma dessas, crie uma categoria lógica nova.\n" +
                "   - valor: o valor numérico.\n" +
                "   - data: se o usuário mencionou uma data específica (ex: 'dia 27/05', '27/05', '27 de maio'), converta-a para o formato 'YYYY-MM-DD'. O ano atual é 2026. Se não houver ano na mensagem, use 2026. Se houver ano explícito (ex: '27/05/2025'), respeite-o. Se não houver data na mensagem, retorne null.\n" +
                "2. Se ele quer CONSULTAR relatórios: defina 'eConsulta' como true e extraia opcionalmente:\n" +
                "   - categoriaConsulta: a categoria que ele quer filtrar (ou null/'todos' para todas).\n" +
                "   - mesConsulta: número do mês (1 a 12) se ele mencionar um mês específico (ex: 'abril', 'mês 4', 'relatório de maio'). Se não mencionar, retorne null.\n" +
                "   - anoConsulta: ano do mês (ex: 2026). Se não mencionar ano, assuma o ano atual 2026. Se não houver mês, retorne null.\n" +
                "3. Se ele quer APAGAR um gasto específico: defina 'eExclusao' como true e extraia nome e valor.\n" +
                "4. Se ele quer APAGAR TODOS os gastos de uma vez (ex: 'apagar tudo', 'limpar histórico', 'zerar gastos'): defina 'eExclusaoTotal' como true e todos os outros false.\n" +
                "5. Se for conversa normal (sem intenção de gastos): defina TODOS os booleanos como false e preencha o campo 'respostaConversa' com uma resposta natural, engraçada e descontraída, como se você fosse um amigo próximo do Leo. Use emojis e seja bem informal!\n" +
                "Importante: Seja preciso. Farmácia é categoria 'saude', não 'comida'.\n" +
                "Responda APENAS com um objeto JSON. Não escreva nada antes ou depois do JSON. O JSON deve ter os campos: eGasto, eConsulta, eExclusao, eExclusaoTotal, nome, tipo, valor, data, categoriaConsulta, mesConsulta, anoConsulta, respostaConversa.";

            const response = await openai.chat.completions.create({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: promptDoSistema },
                    { role: "user", content: msg.body }
                ],
                response_format: { type: "json_object" }
            });

            let analiseIA;
            try {
                analiseIA = JSON.parse(response.choices[0].message.content);
            } catch (e) {
                console.error("Erro ao converter resposta da IA para JSON:", response.choices[0].message.content);
                await msg.reply("Leo, o cérebro da IA deu um nó aqui. Pode repetir a mensagem?");
                return;
            }

            // 🔀 FLUXO 1: Cadastrar Gasto (com data)
            if (analiseIA.eGasto) {
                const nomeGasto = analiseIA.nome.toLowerCase().trim();
                const categoriaGasto = analiseIA.tipo.toLowerCase().trim();
                const dataGasto = analiseIA.data || null;
                
                await db.salvarGasto(msg.from, nomeGasto, categoriaGasto, analiseIA.valor, dataGasto);
                
                let dataFormatada = 'Data atual';
                if (dataGasto) {
                    const [ano, mes, dia] = dataGasto.split('-');
                    dataFormatada = `${dia}/${mes}/${ano}`;
                }
                
                await msg.reply(
                    `💰 *Gasto Anotado!*\n\n` +
                    `• *Local:* ${nomeGasto}\n` +
                    `• *Categoria:* ${categoriaGasto}\n` +
                    `• *Valor:* R$ ${Number(analiseIA.valor).toFixed(2)}\n` +
                    `• *Data:* ${dataFormatada}\n\n` +
                    `_Salvo com sucesso no MariaDB!_`
                );
            } 
            // 🔀 FLUXO 2: Consultar Relatório (agora com filtro de mês/ano)
            else if (analiseIA.eConsulta) {
                // Extrai parâmetros de filtro
                const categoria = analiseIA.categoriaConsulta || null;
                const mes = analiseIA.mesConsulta || null;
                const ano = mes ? (analiseIA.anoConsulta || 2026) : null; // se tem mês, usa ano ou 2026

                const listaGastos = await db.puxarGastos(msg.from, categoria, mes, ano);
                
                // Prepara uma descrição do período para a mensagem
                let descricaoPeriodo = '';
                if (mes && ano) {
                    const nomeMes = new Date(ano, mes - 1).toLocaleString('pt-BR', { month: 'long' });
                    descricaoPeriodo = `do mês de ${nomeMes} de ${ano}`;
                }

                if (listaGastos.length === 0) {
                    const msgErro = descricaoPeriodo 
                        ? `📊 Nenhum gasto encontrado ${descricaoPeriodo}, Leo!`
                        : "📊 Não encontrei nenhum gasto registrado nessa categoria, Leo!";
                    await msg.reply(msgErro);
                    return;
                }

                const totalGeral = listaGastos.reduce((soma, item) => soma + Number(item.valor), 0);

                const promptRelatorio = 
                    `O usuário Leo solicitou um relatório financeiro ${descricaoPeriodo ? descricaoPeriodo : 'geral'}.\n` +
                    `Aqui estão os dados reais extraídos diretamente do banco MariaDB (ordenados do mais antigo para o mais novo):\n` +
                    `${JSON.stringify(listaGastos)}\n` +
                    `Total acumulado: R$ ${totalGeral.toFixed(2)}.\n\n` +
                    `Sua tarefa: Monte uma mensagem de relatório amigável, muito bem organizada e legível para o WhatsApp. ` +
                    `Para cada item listado, você DEVE obrigatoriamente exibir a data (campo 'data_formatada'), a categoria (campo 'tipo'), o nome e o valor. ` +
                    `No final do texto, destaque o Valor Total Acumulado em negrito.`;
                
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
                    await msg.reply(`🗑️ *Gasto Removido!*\n\nDeletei com sucesso o gasto de *R$ ${Number(analiseIA.valor).toFixed(2)}* no *${nomeAlvo}* do seu MariaDB!`);
                } else {
                    await msg.reply(`📊 Leo, procurei no banco mas não achei nenhum gasto recente de *R$ ${Number(analiseIA.valor).toFixed(2)}* no *${nomeAlvo}* para apagar.`);
                }
            }
            // 🔀 FLUXO 3.5: Deletar TODOS os gastos
            else if (analiseIA.eExclusaoTotal) {
                const linhasApagadas = await db.deletarTodosGastos(msg.from);
                if (linhasApagadas > 0) {
                    await msg.reply(`🗑️ *Todos os gastos foram removidos!* Apaguei ${linhasApagadas} registro(s) do seu banco.`);
                } else {
                    await msg.reply(`📊 Não havia nenhum gasto registrado para apagar, Leo.`);
                }
            }
            // 🔀 FLUXO 4: Conversa Fiada (ATUALIZADO)
            else {
                // Se a IA gerou uma resposta conversacional, usa ela
                if (analiseIA.respostaConversa) {
                    await msg.reply(analiseIA.respostaConversa);
                } else {
                    // Fallback: tenta gerar uma resposta com a IA
                    try {
                        const respostaFallback = await openai.chat.completions.create({
                            model: "llama-3.3-70b-versatile",
                            messages: [
                                { role: "system", content: "Você é o assistente financeiro do Leo. Responda de forma natural, engraçada e amigável. Use emojis. Seja descontraído como se fosse um amigo próximo." },
                                { role: "user", content: msg.body }
                            ]
                        });
                        await msg.reply(respostaFallback.choices[0].message.content);
                    } catch (e) {
                        // Se a IA falhar, usa respostas padrão variadas
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
            console.error('❌ Erro no Groq:', error);
            
            // Mensagem de erro mais amigável
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