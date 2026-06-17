// 1. Carrega as variáveis do arquivo .env antes de qualquer outra coisa
require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenAI, Type } = require('@google/genai'); 
const db = require('./database'); // Importa o seu arquivo database.js do MariaDB

// 2. Inicializa o cliente apontando para o Chromium do seu Arch Linux
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Puxa as configurações e as travas de segurança do seu arquivo oculto .env
const MEU_NUMERO_PESSOAL = process.env.MEU_NUMERO_PESSOAL;
const MEU_ID_MASCARADO   = process.env.MEU_ID_MASCARADO;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;

// Inicializa a inteligência do Google com a sua chave
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Exibe o QR Code no terminal se a sessão expirar
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('✨ Escaneie o QR Code acima com o seu número do BOT!');
});

client.on('ready', () => {
    console.log('🚀 O seu assistente de gastos está online e pronto!');
});

// 🤖 O CORAÇÃO DO BOT: Escuta e filtra as mensagens recebidas
client.on('message', async (msg) => {
    console.log(`[WhatsApp]: Mensagem de ${msg.from} | Texto: ${msg.body}`);

    // 🔒 TRAVA DE SEGURANÇA MÁXIMA: Só responde se a mensagem vier de você
    if (msg.from === MEU_NUMERO_PESSOAL || msg.from === MEU_ID_MASCARADO) {
        
        try {
            const chat = await msg.getChat();
            await chat.sendStateTyping(); // Simula o "digitando..." para dar realismo

            // Orientação do sistema moldando o comportamento do robô
            const promptDoSistema = 
                "Você é o assistente pessoal e financeiro do Leo. " +
                "Sua tarefa é analisar a mensagem dele. Se ele estiver apenas conversando, cumprimentando ou fazendo perguntas gerais, responda amigavelmente no campo 'respostaConversa' e defina 'eGasto' como false. " +
                "Se ele descrever um gasto (ex: 'ifood de comida 50 reais'), extraia os dados nos campos correspondentes, defina 'eGasto' como true e deixe 'respostaConversa' em branco.";

            // Molde do JSON estruturado que exigimos da IA
            const schemaDeGastos = {
                type: Type.OBJECT,
                properties: {
                    eGasto: { type: Type.BOOLEAN, description: "Defina como true se a mensagem for estritamente o registro de um gasto. Defina como false se for apenas uma conversa, saudação ou pergunta." },
                    nome: { type: Type.STRING, description: "O nome do local ou produto comprado. Preencha apenas se eGasto for true. Ex: ifood, posto, mercado." },
                    tipo: { type: Type.STRING, description: "A categoria do gasto. Preencha apenas se eGasto for true. Ex: comida, combustivel, lazer." },
                    valor: { type: Type.NUMBER, description: "O valor numérico puro do gasto. Preencha apenas se eGasto for true." },
                    respostaConversa: { type: Type.STRING, description: "Se eGasto for false, escreva aqui uma resposta natural, amigável e direta para o Leo." }
                },
                required: ["eGasto"], // Obriga a IA a decidir primeiro se é um gasto ou não
            };

            // Dispara para o Gemini 2.5 Flash processar o texto
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: msg.body,
                config: {
                    systemInstruction: promptDoSistema,
                    responseMimeType: "application/json",
                    responseSchema: schemaDeGastos,
                }
            });

            // Converte o texto da IA em dados usáveis pelo Node
            const analiseIA = JSON.parse(response.text);
            console.log('🧠 Geminaldo analisou a mensagem:', analiseIA);

            // 🔀 DECISÃO: É para salvar no banco ou trocar ideia?
            if (analiseIA.eGasto) {
                
                // 🗄️ Salva na sua tabela do MariaDB chamando a função do database.js
                await db.salvarGasto(
                    msg.from, 
                    analiseIA.nome, 
                    analiseIA.tipo, 
                    analiseIA.valor
                );

                // Manda a confirmação bonita no seu WhatsApp
                await msg.reply(
                    `💰 *Gasto Anotado!*\n\n` +
                    `• *Local:* ${analiseIA.nome}\n` +
                    `• *Categoria:* ${analiseIA.tipo}\n` +
                    `• *Valor:* R$ ${Number(analiseIA.valor).toFixed(2)}\n\n` +
                    `_Salvo com sucesso no MariaDB!_`
                );

            } else {
                // Se NÃO for gasto, ele só responde o que escreveu no campo de conversa, batendo papo
                await msg.reply(analiseIA.respostaConversa || "Tô te ouvindo, Leo! Pode falar.");
            }

        } catch (error) {
            console.error('❌ Erro no processamento interno:', error);
            await msg.reply('Ops, Leo! Deu um erro aqui na hora de processar essa mensagem.');
        }
        
    } else {
        // Ignora grupos e outras pessoas por segurança
        console.log(`[Segurança]: Mensagem de ${msg.from} ignorada.`);
    }
});

// Inicializa o WhatsApp Web
client.initialize();