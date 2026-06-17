require('dotenv').config();
const mysql = require('mysql2/promise');

let pool;

// Conexão e criação de tabelas (mantido como antes, com data_gasto)
async function conectarBanco() {
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'leo_bot',
            password: process.env.DB_PASS,
            database: process.env.DB_NAME || 'boot_assistente',
            waitForConnections: true,
            connectionLimit: 5,
            queueLimit: 0
        });

        console.log('🗄️ Conexão com o MariaDB configurada com sucesso!');
        await criarTabelaGastos();
        await garantirColunaDataGasto();
    } catch (err) {
        console.error('❌ Erro ao conectar no MariaDB:', err.message);
    }
}

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
        console.log('✨ Tabela de GASTOS verificada/criada no banco!');
    } catch (err) {
        console.error('❌ Erro ao criar tabela de gastos:', err.message);
    }
}

async function garantirColunaDataGasto() {
    try {
        const [rows] = await pool.query(`
            SELECT COLUMN_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'gastos' 
              AND COLUMN_NAME = 'data_gasto'
              AND TABLE_SCHEMA = ?
        `, [process.env.DB_NAME || 'boot_assistente']);

        if (rows.length === 0) {
            await pool.query(`ALTER TABLE gastos ADD COLUMN data_gasto DATE AFTER valor`);
            console.log('✅ Coluna data_gasto adicionada com sucesso!');
        }
    } catch (err) {
        console.error('❌ Erro ao verificar/criar coluna data_gasto:', err.message);
    }
}

conectarBanco();

module.exports = {
    salvarGasto: async (whatsappId, nome, tipo, valor, dataGasto = null) => {
        const dataFinal = dataGasto || new Date().toISOString().slice(0, 10);
        const sql = `INSERT INTO gastos (whatsapp_id, nome, tipo, valor, data_gasto) VALUES (?, ?, ?, ?, ?)`;
        const [result] = await pool.execute(sql, [whatsappId, nome, tipo, valor, dataFinal]);
        return result.insertId;
    },

    // Função de consulta melhorada: aceita filtro de categoria e mês/ano, ordena do mais antigo para o mais novo
    puxarGastos: async (whatsappId, categoria = null, mes = null, ano = null) => {
        let sql = `SELECT nome, tipo, valor, DATE_FORMAT(data_gasto, '%d/%m/%Y') as data_formatada 
                   FROM gastos WHERE whatsapp_id = ?`;
        const params = [whatsappId];

        // Filtro de categoria (opcional)
        if (categoria && categoria !== 'todos' && categoria !== '') {
            sql += ` AND tipo = ?`;
            params.push(categoria);
        }

        // Filtro de mês/ano (opcional) – ex: mês=4, ano=2026
        if (mes && ano) {
            const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
            sql += ` AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)`;
            params.push(primeiroDia, primeiroDia); // primeiro parâmetro para >=, segundo para LAST_DAY
        }

        sql += ` ORDER BY data_gasto ASC, id ASC`;  // Mais antigo primeiro
        const [rows] = await pool.execute(sql, params);
        return rows;
    },

    deletarGasto: async (whatsappId, nome, valor) => {
        const sql = `DELETE FROM gastos WHERE whatsapp_id = ? AND nome = ? AND valor = ?`;
        const [result] = await pool.execute(sql, [whatsappId, nome, parseFloat(valor)]);
        return result.affectedRows;
    },

    deletarTodosGastos: async (whatsappId) => {
        const sql = `DELETE FROM gastos WHERE whatsapp_id = ?`;
        const [result] = await pool.execute(sql, [whatsappId]);
        return result.affectedRows;
    }
};