const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

// suporte a fetch no Node: usa global fetch (Node >=18) ou node-fetch (Node <18)
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (e) {
    console.warn('node-fetch não instalado — instale com: npm install node-fetch@2');
  }
}


const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

// 1. SERVIR ARQUIVOS ESTÁTICOS (CSS, IMAGENS, JS)
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// PROXY para Nominatim (reverse geocoding) - evita CORS no browser
app.get('/reverse', async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'missing lat or lon' });

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;

    const r = await fetchFn(nominatimUrl, {
      headers: {
        // **TROQUE PELO SEU EMAIL REAL AQUI**
        'User-Agent': 'FalcaoApp/1.0 (seu-email@exemplo.com)'
      },
      timeout: 10000
    });

    const text = await r.text();
    if (!r.ok) {
      // repassa o status e a mensagem do nominatim (p.ex. 503)
      return res.status(r.status).send(text);
    }

    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch (err) {
      return res.send(text);
    }
  } catch (err) {
    console.error('proxy /reverse error:', err);
    return res.status(500).json({ error: 'proxy failed', details: String(err) });
  }
});
// PROXY para Nominatim (reverse geocoding) - evita CORS no browser
app.get('/reverse', async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'missing lat or lon' });

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;

    const r = await fetchFn(nominatimUrl, {
      headers: {
        // **TROQUE PELO SEU EMAIL REAL AQUI**
        'User-Agent': 'FalcaoApp/1.0 (seu-email@exemplo.com)'
      },
      timeout: 10000
    });

    const text = await r.text();
    if (!r.ok) {
      // repassa o status e a mensagem do nominatim (p.ex. 503)
      return res.status(r.status).send(text);
    }

    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch (err) {
      return res.send(text);
    }
  } catch (err) {
    console.error('proxy /reverse error:', err);
    return res.status(500).json({ error: 'proxy failed', details: String(err) });
  }
});

// rota curta /app redireciona para /install.html
app.get('/app', (req, res) => {
    res.sendFile(path.join(__dirname, 'app.html'));
});


// COLE A ROTA /install APÓS AQUI
app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'install.html'));
});

// 2. LOG DE PEDIDOS (Para a gente ver nos logs o que está acontecendo)
app.use((req, res, next) => {
    console.log(`--> Recebi pedido para: ${req.url}`);
    next();
});

// 3. ROTA DA PÁGINA INICIAL (FORÇADA)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- BANCO DE DADOS ---
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/falcoes_app';
const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- CRIAÇÃO DAS TABELAS (SEGURANÇA) ---
const initDB = async () => {
    try {
        await pool.query(`
CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY,
    nome VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    senha VARCHAR(100),
    tipo VARCHAR(20),
    telefone VARCHAR(20),
    placa VARCHAR(20),
    modelo_moto VARCHAR(50),
    cor_moto VARCHAR(30),
    categoria VARCHAR(50),
    aprovado BOOLEAN DEFAULT false,
    bloqueado_ate TIMESTAMP,
    foto_cnh VARCHAR(255),
    foto_moto VARCHAR(255),
    foto_rosto VARCHAR(255)
);
`);

        await pool.query(`
CREATE TABLE IF NOT EXISTS corridas (
    id SERIAL PRIMARY KEY,
    cliente_id INTEGER REFERENCES usuarios(id),
    motoboy_id INTEGER REFERENCES usuarios(id),
    origem VARCHAR(255),
    destino VARCHAR(255),
    distancia_km DECIMAL(10,2),
    valor DECIMAL(10,2),
    status VARCHAR(50) DEFAULT 'pendente',
    tipo_servico VARCHAR(50),
    motivo_cancelamento TEXT,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
await pool.query(`
CREATE TABLE IF NOT EXISTS mensagens (
    id SERIAL PRIMARY KEY,
    corrida_id INTEGER REFERENCES corridas(id),
    remetente VARCHAR(20),
    texto TEXT,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

        console.log('✅ Tabelas Verificadas/Criadas!');
    } catch (err) { console.error('❌ Erro ao criar tabelas:', err); }
};
initDB();

// --- ROTAS DO APP ---

// ROTA DE CADASTRO INTELIGENTE
app.post('/cadastro', async (req, res) => {
    const { nome, email, senha, tipo, telefone, placa, modelo_moto, cor_moto, categoria } = req.body;
    
    try {
        // 1. Verifica quantos usuários existem no banco
        const contagem = await pool.query("SELECT COUNT(*) FROM usuarios");
        const totalUsuarios = parseInt(contagem.rows[0].count);

        let estaAprovado = false;
        let tipoFinal = tipo; // O tipo que a pessoa escolheu

        // 2. SE FOR O PRIMEIRO DO MUNDO, VIRA CHEFE
        if (totalUsuarios === 0) {
            tipoFinal = 'admin';
            estaAprovado = true; // O primeiro já entra aprovado
            console.log("👑 PRIMEIRO USUÁRIO DETECTADO: Criando Admin Supremo.");
        } else {
            // Se for cliente, aprova direto
            estaAprovado = tipo === 'cliente' ? true : false; 
        }

        const result = await pool.query(
            'INSERT INTO usuarios (nome, email, senha, tipo, telefone, placa, modelo_moto, cor_moto, categoria, aprovado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [nome, email, senha, tipoFinal, telefone, placa, modelo_moto, cor_moto, categoria, estaAprovado]
        );

        if (estaAprovado) {
            res.json({ success: true, message: 'Conta Criada com Sucesso!' });
        } else {
            res.json({ success: true, message: 'Cadastro enviado! Aguarde aprovação.' });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Erro ao cadastrar. Email já existe?' });
    }
});
app.post('/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND senha = $2', [email, senha]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (user.tipo === 'admin') return res.json({ success: true, user });
            if (!user.aprovado) return res.status(401).json({ success: false, message: 'Sua conta está em análise.' });
            res.json({ success: true, user });
        } else { res.status(401).json({ success: false, message: 'Email ou senha incorretos.' }); }
    } catch (err) { res.status(500).json({ success: false, message: "Erro no servidor" }); }
});

app.post('/pedir-corrida', async (req, res) => {
    const { cliente_id, origem, destino, valor, tipo_servico } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO corridas (cliente_id, origem, destino, valor, status, tipo_servico) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [cliente_id, origem, destino, valor, 'pendente', tipo_servico]
        );
        res.json({ success: true, message: 'Enviado!', id: result.rows[0].id });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/cancelar-pedido', async (req, res) => {
    const { id, motivo } = req.body;
    try {
        await pool.query("UPDATE corridas SET status = 'cancelada', motivo_cancelamento = $1 WHERE id = $2", [motivo, id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/corridas-pendentes', async (req, res) => {
    const { motoboy_id } = req.body;
    try {
        const motoboy = await pool.query("SELECT bloqueado_ate FROM usuarios WHERE id = $1", [motoboy_id]);
        if (motoboy.rows.length > 0 && motoboy.rows[0].bloqueado_ate) {
            if (new Date(motoboy.rows[0].bloqueado_ate) > new Date()) {
                const min = Math.ceil((new Date(motoboy.rows[0].bloqueado_ate) - new Date()) / 60000);
                return res.json({ success: false, bloqueado: true, tempo: min });
            }
        }
        const result = await pool.query(`SELECT c.*, u.nome as nome_cliente, u.telefone as telefone_cliente FROM corridas c JOIN usuarios u ON c.cliente_id = u.id WHERE c.status = 'pendente'`);
        res.json({ success: true, corridas: result.rows });
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/aceitar-corrida', async (req, res) => {
    const { corrida_id, motoboy_id } = req.body;
    try {
        await pool.query("UPDATE corridas SET status = 'aceita', motoboy_id = $1 WHERE id = $2", [motoboy_id, corrida_id]);
        await pool.query("UPDATE usuarios SET bloqueado_ate = NOW() + interval '10 minutes' WHERE id = $1", [motoboy_id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/finalizar-corrida', async (req, res) => {
    try { await pool.query("UPDATE corridas SET status = 'concluida' WHERE id = $1", [req.body.corrida_id]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/minha-corrida-atual/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.*, u.nome as nome_cliente, u.telefone as telefone_cliente FROM corridas c JOIN usuarios u ON c.cliente_id = u.id WHERE c.motoboy_id = $1 AND c.status = 'aceita'`, [req.params.id]);
        if (result.rows.length > 0) res.json({ tem_corrida: true, corrida: result.rows[0] });
        else res.json({ tem_corrida: false });
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/status-pedido/:id', async (req, res) => {
    try {
        const result = await pool.query(`SELECT c.status, u.nome as nome_motoboy, u.telefone as telefone_motoboy, u.modelo_moto, u.placa, u.cor_moto FROM corridas c LEFT JOIN usuarios u ON c.motoboy_id = u.id WHERE c.id = $1`, [req.params.id]);
        if(result.rows.length > 0) res.json({ success: true, pedido: result.rows[0] });
        else res.json({ success: false });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/enviar-mensagem', async (req, res) => {
    const { corrida_id, remetente, texto } = req.body;
    try { await pool.query("INSERT INTO mensagens (corrida_id, remetente, texto) VALUES ($1, $2, $3)", [corrida_id, remetente, texto]); res.json({ success: true }); } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/mensagens/:id', async (req, res) => {
    try { const result = await pool.query("SELECT * FROM mensagens WHERE corrida_id = $1 ORDER BY data_hora ASC", [req.params.id]); res.json(result.rows); } catch (err) { res.status(500).json({ success: false }); }
});

// --- ROTAS DO ADMIN (EXISTENTES) ---

app.get('/admin/dashboard', async (req, res) => {
    try {
        const hoje = await pool.query("SELECT COUNT(*) FROM corridas WHERE data_hora::date = CURRENT_DATE");
        const mes = await pool.query("SELECT COUNT(*) FROM corridas WHERE EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE)");
        const entregas = await pool.query("SELECT COUNT(*) FROM corridas WHERE tipo_servico = 'entrega'");
        const motoTaxi = await pool.query("SELECT COUNT(*) FROM corridas WHERE tipo_servico = 'moto-taxi'");
        const historico = await pool.query(`SELECT c.id, c.origem, c.destino, c.valor, c.tipo_servico, c.status, c.motivo_cancelamento, u.nome as nome_motoboy FROM corridas c LEFT JOIN usuarios u ON c.motoboy_id = u.id ORDER BY c.id DESC LIMIT 10`);
        res.json({ total_hoje: hoje.rows[0].count, total_mes: mes.rows[0].count, qtd_entrega: entregas.rows[0].count, qtd_moto: motoTaxi.rows[0].count, historico: historico.rows });
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.get('/admin/pendentes', async (req, res) => {
    try { 
        const result = await pool.query("SELECT * FROM usuarios WHERE aprovado = false AND tipo = 'motoboy' ORDER BY id DESC"); 
        res.json(result.rows); 
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

app.post('/admin/aprovar', async (req, res) => { 
    try { 
        await pool.query("UPDATE usuarios SET aprovado = true WHERE id = $1", [req.body.id]); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false }); } 
});

app.post('/admin/rejeitar', async (req, res) => { 
    try { 
        await pool.query("DELETE FROM usuarios WHERE id = $1", [req.body.id]); 
        res.json({ success: true }); 
    } catch (err) { res.status(500).json({ success: false }); } 
});

// --- ROTAS NOVAS DE ADMIN PARA GESTÃO DE USUÁRIOS E REMOÇÃO (SOLICITADAS) ---

/**
 * ROTA SOLICITADA: Retorna a lista de motoboys APROVADOS e ATIVOS.
 */
app.get('/admin/motoboys', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, nome, email, telefone, placa, modelo_moto, cor_moto, categoria, aprovado 
            FROM usuarios 
            WHERE tipo = 'motoboy' AND aprovado = true 
            ORDER BY nome ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar motoboys:', err);
        res.status(500).json({ error: 'Erro ao buscar motoboys' });
    }
});

/**
 * ROTA SOLICITADA: Retorna a lista de clientes.
 */
app.get('/admin/clientes', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, nome, email, telefone 
            FROM usuarios 
            WHERE tipo = 'cliente' 
            ORDER BY nome ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Erro ao buscar clientes:', err);
        res.status(500).json({ error: 'Erro ao buscar clientes' });
    }
});

/**
 * ROTA SOLICITADA: Remove um usuário (motoboy, cliente ou admin) pelo ID.
 */
app.delete('/admin/remover/:id', async (req, res) => {
    const userId = req.params.id;
    try {
        const deleteResult = await pool.query("DELETE FROM usuarios WHERE id = $1 RETURNING id", [userId]);
        
        if (deleteResult.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
        }
        
        res.json({ success: true, message: 'Usuário removido com sucesso.' });
    } catch (err) {
        console.error('Erro ao remover usuário:', err);
        if (err.code === '23503') { // PostgreSQL error code for foreign key violation
            return res.status(409).json({ success: false, message: 'Não é possível remover o usuário. Ele ainda possui dados associados (corridas/mensagens).' });
        }
        res.status(500).json({ success: false, message: 'Erro interno ao remover o usuário.' });
    }
});


app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});