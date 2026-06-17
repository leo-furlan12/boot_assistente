require('dotenv').config();
const mysql = require('mysql2/promise');

let pool;

// 1. Inicializa o pool de conexões puxando TUDO do arquivo .env com segurança
async function conectarBanco() {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'leo_bot',
            password: process.env.DB_PASS, // 🔒 PUXA DA .ENV (SEM SENHA EXPOSTA AQUI!)
            database: process.env.DB_NAME || 'boot_assistente',
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });

        console.log('🗄️ Conexão com o MariaDB configurada com sucesso!');
        await criarTabelaGastos();
    } catch (err) {
        console.error('❌ Erro ao conectar no MariaDB:', err.message);
    }
}

// 2. Cria a tabela de gastos exatamente com os campos que você pediu
async function criarTabelaGastos() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gastos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                whatsapp_id VARCHAR(50) NOT NULL,
                nome VARCHAR(100) NOT NULL,
                tipo VARCHAR(50) NOT NULL,
                valor DECIMAL(10,2) NOT NULL,
                data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✨ Tabela de GASTOS verificada/criadas no banco!');
    } catch (err) {
        console.error('❌ Erro ao criar tabela de gastos:', err.message);
    }
}

// Inicializa a checagem do banco na hora que o bot puxar o arquivo
conectarBanco();

// 3. Exporta a função que vai salvar os seus gastos no banco de dados
module.exports = {
    salvarGasto: async (whatsappId, nome, tipo, valor) => {
        const sql = `INSERT INTO gastos (whatsapp_id, nome, tipo, valor) VALUES (?, ?, ?, ?)`;
        const [result] = await pool.execute(sql, [whatsappId, nome, tipo, valor]);
        return result.insertId;
    }
};