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
            params.push(primeiroDia, primeiroDia);
        }

        sql += ` ORDER BY data_gasto ASC, id ASC`;
        const [rows] = await pool.execute(sql, params);
        return rows;
    },

    // Buscar dados agregados por categoria (para gráficos)
    puxarGastosAgrupados: async (whatsappId, mes = null, ano = null) => {
        let sql = `SELECT tipo, SUM(valor) as total 
                   FROM gastos WHERE whatsapp_id = ?`;
        const params = [whatsappId];

        if (mes && ano) {
            const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
            sql += ` AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)`;
            params.push(primeiroDia, primeiroDia);
        }

        sql += ` GROUP BY tipo ORDER BY total DESC`;
        const [rows] = await pool.execute(sql, params);
        return rows;
    },

    // Buscar gastos por dia (para gráfico de linha/tendência)
    puxarGastosDiarios: async (whatsappId, mes = null, ano = null) => {
        let sql = `SELECT data_gasto as dia, SUM(valor) as total 
                   FROM gastos WHERE whatsapp_id = ?`;
        const params = [whatsappId];

        if (mes && ano) {
            const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
            sql += ` AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)`;
            params.push(primeiroDia, primeiroDia);
        }

        sql += ` GROUP BY data_gasto ORDER BY data_gasto ASC`;
        const [rows] = await pool.execute(sql, params);
        return rows;
    },

    // Dashboard - Total de um mês específico
    puxarTotalMes: async (whatsappId, mes, ano) => {
        const primeiroDia = `${ano}-${String(mes).padStart(2, '0')}-01`;
        
        const sql = `SELECT COALESCE(SUM(valor), 0) as total 
                     FROM gastos 
                     WHERE whatsapp_id = ? 
                     AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)`;
        const [rows] = await pool.execute(sql, [whatsappId, primeiroDia, primeiroDia]);
        return rows[0].total;
    },

    // Dashboard - Total do mês atual
    puxarTotalMesAtual: async (whatsappId) => {
        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = agora.getMonth() + 1;
        return await module.exports.puxarTotalMes(whatsappId, mes, ano);
    },

    // Dashboard - Total do mês anterior
    puxarTotalMesAnterior: async (whatsappId) => {
        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = agora.getMonth(); // Mês anterior (0-11)
        
        const anoMesAnterior = mes === 0 ? ano - 1 : ano;
        const mesAnterior = mes === 0 ? 12 : mes;
        
        return await module.exports.puxarTotalMes(whatsappId, mesAnterior, anoMesAnterior);
    },

    // Dashboard - Top 3 categorias de um mês específico
    puxarTopCategoriasMes: async (whatsappId, mes = null, ano = null) => {
        const agora = new Date();
        const mesUsar = mes || (agora.getMonth() + 1);
        const anoUsar = ano || agora.getFullYear();
        const primeiroDia = `${anoUsar}-${String(mesUsar).padStart(2, '0')}-01`;
        
        const sql = `SELECT tipo, SUM(valor) as total 
                     FROM gastos 
                     WHERE whatsapp_id = ? 
                     AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)
                     GROUP BY tipo 
                     ORDER BY total DESC 
                     LIMIT 3`;
        const [rows] = await pool.execute(sql, [whatsappId, primeiroDia, primeiroDia]);
        return rows;
    },

    // Dashboard - Média diária de um mês específico
    puxarMediaDiariaMes: async (whatsappId, mes = null, ano = null) => {
        const agora = new Date();
        const mesUsar = mes || (agora.getMonth() + 1);
        const anoUsar = ano || agora.getFullYear();
        const primeiroDia = `${anoUsar}-${String(mesUsar).padStart(2, '0')}-01`;
        
        const sql = `SELECT COALESCE(SUM(valor), 0) as total,
                     COUNT(DISTINCT data_gasto) as dias_com_gasto,
                     COALESCE(SUM(valor) / NULLIF(COUNT(DISTINCT data_gasto), 0), 0) as media_diaria
                     FROM gastos 
                     WHERE whatsapp_id = ? 
                     AND data_gasto >= ? AND data_gasto <= LAST_DAY(?)`;
        const [rows] = await pool.execute(sql, [whatsappId, primeiroDia, primeiroDia]);
        return {
            total: rows[0].total,
            diasComGasto: rows[0].dias_com_gasto,
            mediaDiaria: rows[0].media_diaria
        };
    },

    // Dashboard - Média diária do mês anterior
    puxarMediaDiariaMesAnterior: async (whatsappId) => {
        const agora = new Date();
        const ano = agora.getFullYear();
        const mes = agora.getMonth();
        
        const anoMesAnterior = mes === 0 ? ano - 1 : ano;
        const mesAnterior = mes === 0 ? 12 : mes;
        
        return await module.exports.puxarMediaDiariaMes(whatsappId, mesAnterior, anoMesAnterior);
    },

    // Dashboard - Dias de um mês específico
    puxarDiasDoMes: (mes = null, ano = null) => {
        const agora = new Date();
        const mesUsar = mes || (agora.getMonth() + 1);
        const anoUsar = ano || agora.getFullYear();
        return new Date(anoUsar, mesUsar, 0).getDate();
    },

    // Dashboard - Dias do mês atual
    puxarDiasDoMesAtual: async () => {
        return module.exports.puxarDiasDoMes();
    },

    // Dashboard - Gastos totais por mês nos últimos 6 meses
    puxarHistoricoMensal: async (whatsappId, quantidadeMeses = 6) => {
        const sql = `SELECT 
                        DATE_FORMAT(data_gasto, '%Y-%m') as mes,
                        SUM(valor) as total,
                        COUNT(*) as quantidade
                     FROM gastos 
                     WHERE whatsapp_id = ?
                     GROUP BY DATE_FORMAT(data_gasto, '%Y-%m')
                     ORDER BY mes DESC
                     LIMIT ?`;
        const [rows] = await pool.execute(sql, [whatsappId, quantidadeMeses]);
        return rows.reverse(); // Ordena do mais antigo para o mais recente
    },

    // 🆕 CORRIGIDO: Deletar gasto - busca mais flexível
    deletarGasto: async (whatsappId, nome, valor) => {
        // Primeiro tenta deletar com nome e valor exatos
        let sql = `DELETE FROM gastos WHERE whatsapp_id = ? AND nome = ? AND valor = ?`;
        let [result] = await pool.execute(sql, [whatsappId, nome, parseFloat(valor)]);
        
        // Se não encontrou, tenta buscar por LIKE (nome parcial)
        if (result.affectedRows === 0) {
            sql = `DELETE FROM gastos WHERE whatsapp_id = ? AND nome LIKE ? AND valor = ?`;
            [result] = await pool.execute(sql, [whatsappId, `%${nome}%`, parseFloat(valor)]);
        }
        
        // Se ainda não encontrou, tenta pelo valor mais recente com nome similar
        if (result.affectedRows === 0) {
            sql = `DELETE FROM gastos WHERE id = (
                SELECT id FROM (
                    SELECT id FROM gastos 
                    WHERE whatsapp_id = ? AND nome LIKE ? 
                    ORDER BY data_gasto DESC LIMIT 1
                ) as temp
            )`;
            [result] = await pool.execute(sql, [whatsappId, `%${nome}%`]);
        }
        
        return result.affectedRows;
    },

    deletarTodosGastos: async (whatsappId) => {
        const sql = `DELETE FROM gastos WHERE whatsapp_id = ?`;
        const [result] = await pool.execute(sql, [whatsappId]);
        return result.affectedRows;
    }
};