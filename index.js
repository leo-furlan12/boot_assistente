// Carrega as variáveis do arquivo .env antes de tudo
require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleGenAI } = require('@google/genai');

// Inicializa o cliente apontando para o Chromium do seu Arch Linux
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: '/usr/bin/chromium',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// 🔒 PUXA AS CONFIGURAÇÕES SEGURAS DO ARQUIVO .ENV
const MEU_NUMERO_PESSOAL = process.env.MEU_NUMERO_PESSOAL;
const MEU_ID_MASCARADO   = process.env.MEU_ID_MASCARADO;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;

// Inicializa a IA com a chave puxada do ambiente seguro
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ... O restante do código abaixo (client.on('qr'), client.on('message'), etc.) continua exatamente IGUAL ao anterior.

// Exibe o QR Code no terminal se precisar de um novo login
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('✨ Escaneie o QR Code acima com o seu número do BOT!');
});

// Mensagem de sucesso quando o login for concluído
client.on('ready', () => {
    console.log('🚀 O seu assistente com IA está online e pronto!');
});

// 🤖 MODO DE DOIS NÚMEROS: Escuta as mensagens recebidas
client.on('message', async (msg) => {
    // Printa no terminal o que você enviou para acompanhar o fluxo [cite: 92]
    console.log(`[WhatsApp]: Mensagem de ${msg.from} | Texto: ${msg.body}`);

    // 🔒 TRAVA DE SEGURANÇA: Só responde se a mensagem vier de você [cite: 98]
    if (msg.from === MEU_NUMERO_PESSOAL || msg.from === MEU_ID_MASCARADO) {
        
        try {
            // Avisa o WhatsApp que o bot está "digitando..." para dar realismo
            const chat = await msg.getChat();
            await chat.sendStateTyping();

            // 🧠 O Promt de Sistema: Aqui definimos a personalidade do bot!
            const promptDoSistema = 
                "Você é o robô assistente pessoal do Leo, rodando localmente no Arch Linux dele. " +
                "Seja prestativo, inteligente, direto ao ponto e use um tom amigável e focado. " +
                "Nas próximas etapas você irá gerenciar as finanças e tarefas dele.";

            // Chama o modelo Gemini 2.5 Flash enviando a mensagem do WhatsApp [cite: 194]
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: msg.body,
                config: {
                    systemInstruction: promptDoSistema
                }
            });

            // Responde diretamente para você no WhatsApp com o texto gerado pela IA!
            await msg.reply(response.text);

        } catch (error) {
            console.error('❌ Erro ao chamar a API do Gemini:', error);
            await msg.reply('Ops, Leo! Deu um erro interno aqui na hora de processar com o Gemini. Dá uma olhada no terminal!');
        }
        
    } else {
        // Ignora grupos, status ou curiosos de fora [cite: 53]
        console.log(`[Segurança]: Mensagem de ${msg.from} ignorada.`);
    }
});

client.initialize();