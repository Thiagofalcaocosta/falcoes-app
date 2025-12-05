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

// rota curta /app redireciona para /install.html
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'install.html'));
});

// 2. LOG DE PEDIDOS
app.use((req, res, next) => {
  console.log(`--> Recebi pedido para: ${req.url}`);
  next();
});

// 3. ROTA DA PÁGINA INICIAL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- BANCO DE DADOS ---
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/falcoes_app';
const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// --- CRIAÇÃO DAS TABELAS ---
const initDB = async () => {
  try {
    // 1. Criação de Usuários (Base)
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
    online_ate TIMESTAMP,
    latitude DECIMAL(10,8),
    longitude DECIMAL(11,8),
    foto_cnh VARCHAR(255),
    foto_moto VARCHAR(255),
    foto_rosto VARCHAR(255)
);
`);

    // 2. Criação de Corridas
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
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- NOVO: tempo total que a corrida ficará exposta para todos motoboys
    tempo_exposicao_total INTEGER DEFAULT 60
);
`);

    // 3. Criação de Mensagens
    await pool.query(`
CREATE TABLE IF NOT EXISTS mensagens (
    id SERIAL PRIMARY KEY,
    corrida_id INTEGER REFERENCES corridas(id),
    remetente VARCHAR(20),
    texto TEXT,
    data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

    // 4. Criação de Exposição (MODIFICADA)
    await pool.query(`
CREATE TABLE IF NOT EXISTS exposicao_corrida (
    id SERIAL PRIMARY KEY,
    corrida_id INTEGER REFERENCES corridas(id),
    motoboy_id INTEGER REFERENCES usuarios(id),
    ordem_exposicao INTEGER,
    data_exposicao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expirada BOOLEAN DEFAULT false
);
`);

    console.log('✅ Tabelas Verificadas/Criadas!');
  } catch (err) { console.error('❌ Erro ao criar tabelas:', err); }
};
initDB();

// --- ROTAS DO APP ---

// ROTA DE CADASTRO
app.post('/cadastro', async (req, res) => {
  const { nome, email, senha, tipo, telefone, placa, modelo_moto, cor_moto, categoria } = req.body;

  try {
    const contagem = await pool.query("SELECT COUNT(*) FROM usuarios");
    const totalUsuarios = parseInt(contagem.rows[0].count);

    let estaAprovado = false;
    let tipoFinal = tipo;

    if (totalUsuarios === 0) {
      tipoFinal = 'admin';
      estaAprovado = true;
      console.log("👑 PRIMEIRO USUÁRIO DETECTADO: Criando Admin Supremo.");
    } else {
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
      'INSERT INTO corridas (cliente_id, origem, destino, valor, status, tipo_servico, tempo_exposicao_total) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [cliente_id, origem, destino, valor, 'pendente', tipo_servico, 60] // 60 segundos total
    );

    // Inicia o processo de exposição para todos motoboys da categoria
    const corridaId = result.rows[0].id;
    await iniciarExposicaoCorrida(corridaId, tipo_servico);

    res.json({ success: true, message: 'Enviado!', id: corridaId });
  } catch (err) { res.status(500).json({ success: false }); }
});

// NOVA FUNÇÃO: Inicia exposição da corrida para todos motoboys da categoria
async function iniciarExposicaoCorrida(corridaId, tipoServico) {
  try {
    // Determina categoria baseada no tipo de serviço
    const categoriaFiltro = tipoServico === 'moto-taxi' ? 'Passageiro' :
      tipoServico === 'entrega' ? 'Entregas' : null;

    let filtroCategoria = '';
    if (categoriaFiltro) {
      filtroCategoria = `AND (categoria = '${categoriaFiltro}' OR categoria = 'Geral')`;
    }

    // Busca todos motoboys online da categoria
    const motoboys = await pool.query(`
      SELECT id FROM usuarios 
      WHERE tipo = 'motoboy' 
      AND aprovado = true 
      AND online_ate > NOW()
      ${filtroCategoria}
      ORDER BY RANDOM()
    `);

    // Se não houver motoboys online, a corrida fica pendente
    if (motoboys.rows.length === 0) {
      console.log(`⚠️ Nenhum motoboy online para corrida ${corridaId}`);
      return;
    }

    // Calcula tempo por motoboy (máximo 30s, mínimo 5s)
    const tempoTotal = 60; // segundos
    const tempoPorMotoboy = Math.min(30, Math.max(5, Math.floor(tempoTotal / motoboys.rows.length)));

    console.log(`📢 Corrida ${corridaId}: ${motoboys.rows.length} motoboys, ${tempoPorMotoboy}s cada`);

    // Registra exposição para cada motoboy com ordem
    for (let i = 0; i < motoboys.rows.length; i++) {
      await pool.query(`
        INSERT INTO exposicao_corrida (corrida_id, motoboy_id, ordem_exposicao) 
        VALUES ($1, $2, $3)
      `, [corridaId, motoboys.rows[i].id, i + 1]);
    }

  } catch (err) {
    console.error('Erro ao iniciar exposição:', err);
  }
}

// ROTA ATUALIZADA: Retorna corrida específica para o motoboy no seu turno
app.post('/corridas-pendentes', async (req, res) => {
  const { motoboy_id } = req.body;

  try {
    // 1. VERIFICAR BLOQUEIO
    const motoboyQuery = await pool.query(
      "SELECT bloqueado_ate, categoria, online_ate FROM usuarios WHERE id = $1",
      [motoboy_id]
    );
    const motoboy = motoboyQuery.rows[0];

    if (!motoboy) return res.status(404).json({ error: 'Motoboy não encontrado.' });

    if (motoboy.bloqueado_ate && new Date(motoboy.bloqueado_ate) > new Date()) {
      const min = Math.ceil((new Date(motoboy.bloqueado_ate) - new Date()) / 60000);
      return res.json({ success: false, bloqueado: true, tempo: min });
    }

    // 2. VERIFICAR SE MOTOBOY ESTÁ ONLINE
    if (!motoboy.online_ate || new Date(motoboy.online_ate) < new Date()) {
      return res.json({ success: false, offline: true, message: 'Você precisa estar online para ver corridas.' });
    }

    // 3. BUSCAR CORRIDA NO TURNO DESTE MOTOBOY
    const result = await pool.query(`
      SELECT 
        c.id, c.origem, c.destino, c.valor, c.tipo_servico, 
        u.nome as nome_cliente, u.telefone as telefone_cliente,
        ec.ordem_exposicao,
        EXTRACT(EPOCH FROM (NOW() - ec.data_exposicao)) as segundos_passados,
        c.tempo_exposicao_total
      FROM exposicao_corrida ec
      JOIN corridas c ON ec.corrida_id = c.id
      JOIN usuarios u ON c.cliente_id = u.id
      WHERE ec.motoboy_id = $1
      AND c.status = 'pendente'
      AND ec.expirada = false
      AND EXTRACT(EPOCH FROM (NOW() - ec.data_exposicao)) < 30 -- Máximo 30s por motoboy
      ORDER BY ec.ordem_exposicao ASC, ec.data_exposicao ASC
      LIMIT 1
    `, [motoboy_id]);

    // 4. SE ENCONTRAR CORRIDA NO TURNO
    if (result.rows.length > 0) {
      const corrida = result.rows[0];
      const segundosPassados = corrida.segundos_passados || 0;
      const tempoRestante = 30 - segundosPassados; // Máximo 30 segundos

      if (tempoRestante > 0) {
        corrida.tempo_restante = Math.ceil(tempoRestante);
        return res.json({ success: true, corridas: [corrida] });
      } else {
        // Tempo expirou para este motoboy, marca como expirada
        await pool.query(
          "UPDATE exposicao_corrida SET expirada = true WHERE corrida_id = $1 AND motoboy_id = $2",
          [corrida.id, motoboy_id]
        );

        // Verifica se todos motoboys já viram esta corrida
        await verificarExposicaoCompleta(corrida.id);
      }
    }

    // 5. SE NÃO ENCONTRAR: RETORNA LISTA VAZIA
    res.json({ success: true, corridas: [] });

  } catch (err) {
    console.error('Erro em /corridas-pendentes:', err);
    res.status(500).json({ error: 'Erro no servidor' });
  }
});

// NOVA FUNÇÃO: Verifica se todos motoboys já viram a corrida
async function verificarExposicaoCompleta(corridaId) {
  try {
    const exposicoes = await pool.query(`
      SELECT COUNT(*) as total, SUM(CASE WHEN expirada = true THEN 1 ELSE 0 END) as expiradas
      FROM exposicao_corrida 
      WHERE corrida_id = $1
    `, [corridaId]);

    const { total, expiradas } = exposicoes.rows[0];

    // Se todos motoboys já viram ou tempo total expirou
    if (parseInt(expiradas) === parseInt(total)) {
      // Marca corrida como exposta para todos
      await pool.query(
        "UPDATE corridas SET status = 'expirada' WHERE id = $1 AND status = 'pendente'",
        [corridaId]
      );
      console.log(`⏰ Corrida ${corridaId} exposta para todos motoboys`);
    }

  } catch (err) {
    console.error('Erro ao verificar exposição completa:', err);
  }
}

// ROTA ATUALIZADA: Aceitar corrida
app.post('/aceitar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id } = req.body;

  try {
    // 1. VERIFICAR SE MOTOBOY ESTÁ ONLINE
    const statusQuery = await pool.query(
      "SELECT online_ate FROM usuarios WHERE id = $1",
      [motoboy_id]
    );

    if (statusQuery.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Motoboy não encontrado.' });
    }

    const motoboy = statusQuery.rows[0];
    if (!motoboy.online_ate || new Date(motoboy.online_ate) < new Date()) {
      return res.status(403).json({ success: false, message: 'Você precisa estar online para aceitar corridas.' });
    }

    // 2. VERIFICAR SE CORRIDA AINDA ESTÁ DISPONÍVEL PARA ESTE MOTOBOY
    const exposicao = await pool.query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - data_exposicao)) as segundos_passados, expirada
      FROM exposicao_corrida 
      WHERE corrida_id = $1 AND motoboy_id = $2
    `, [corrida_id, motoboy_id]);

    if (exposicao.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Corrida não disponível para você.' });
    }

    const segundosPassados = exposicao.rows[0].segundos_passados || 31;
    const expirada = exposicao.rows[0].expirada;

    if (expirada || segundosPassados > 30) {
      return res.status(403).json({ success: false, message: 'Tempo limite expirado para esta corrida.' });
    }

    // 3. Tentar aceitar a corrida
    const updateCorrida = await pool.query(
      "UPDATE corridas SET status = 'aceita', motoboy_id = $1 WHERE id = $2 AND status = 'pendente' RETURNING id",
      [motoboy_id, corrida_id]
    );

    if (updateCorrida.rowCount === 0) {
      return res.status(409).json({ success: false, message: 'Corrida indisponível (já aceita ou cancelada).' });
    }

    // 4. Limpar todas as exposições desta corrida
    await pool.query("DELETE FROM exposicao_corrida WHERE corrida_id = $1", [corrida_id]);

    res.json({ success: true, message: 'Corrida aceita com sucesso.' });

  } catch (err) {
    console.error('Erro em /aceitar-corrida:', err);
    res.status(500).json({ success: false, message: 'Erro interno ao aceitar.' });
  }
});

// ROTA PARA EXPIRAR CORRIDA
app.post('/expirar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id } = req.body;
  const TEMPO_BLOQUEIO_MINUTOS = 10;

  try {
    // Marca exposição deste motoboy como expirada
    await pool.query(
      "UPDATE exposicao_corrida SET expirada = true WHERE corrida_id = $1 AND motoboy_id = $2",
      [corrida_id, motoboy_id]
    );

    // Penaliza o Motoboy com bloqueio de 10 minutos
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NOW() + interval '10 minutes' WHERE id = $1",
      [motoboy_id]
    );

    // Verifica se todos já viram
    await verificarExposicaoCompleta(corrida_id);

    console.log(`[EXPIRADO] Motoboy ${motoboy_id} bloqueado por ${TEMPO_BLOQUEIO_MINUTOS} minutos.`);

    res.json({ success: true, bloqueado: true, tempo: TEMPO_BLOQUEIO_MINUTOS });

  } catch (err) {
    console.error('Erro em /expirar-corrida:', err);
    res.status(500).json({ success: false, message: 'Erro interno ao processar expiração.' });
  }
});

// OUTRAS ROTAS (mantidas iguais)
app.post('/cancelar-pedido', async (req, res) => {
  const { id, motivo } = req.body;
  try {
    await pool.query("UPDATE corridas SET status = 'cancelada', motivo_cancelamento = $1 WHERE id = $2", [motivo, id]);
    // Limpa exposições desta corrida
    await pool.query("DELETE FROM exposicao_corrida WHERE corrida_id = $1", [id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/finalizar-corrida', async (req, res) => {
  try {
    await pool.query("UPDATE corridas SET status = 'concluida' WHERE id = $1", [req.body.corrida_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
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
    if (result.rows.length > 0) res.json({ success: true, pedido: result.rows[0] });
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

// --- ROTA DE STATUS ONLINE ---
app.post('/motoboy/status-online', async (req, res) => {
  const { motoboy_id, online, latitude, longitude } = req.body;

  try {
    if (online) {
      await pool.query(
        `UPDATE usuarios SET 
                    online_ate = NOW() + interval '60 seconds',
                    latitude = $2,
                    longitude = $3
                 WHERE id = $1`,
        [motoboy_id, latitude, longitude]
      );
      console.log(`✅ Motoboy ${motoboy_id} agora está ONLINE`);
    } else {
      await pool.query("UPDATE usuarios SET online_ate = NULL WHERE id = $1", [motoboy_id]);
      console.log(`🔴 Motoboy ${motoboy_id} agora está OFFLINE`);
    }

    res.json({ success: true, status: online ? 'ONLINE' : 'OFFLINE' });

  } catch (err) {
    console.error('Erro em /motoboy/status-online:', err);
    res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
  }
});

// --- ROTAS DO ADMIN ---
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

app.get('/admin/motoboys', async (req, res) => {
  try {
    const result = await pool.query(`
            SELECT id, nome, email, telefone, placa, modelo_moto, cor_moto, categoria, aprovado,
                   CASE WHEN online_ate > NOW() THEN 'Online' ELSE 'Offline' END as status_online
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
    if (err.code === '23503') {
      return res.status(409).json({ success: false, message: 'Não é possível remover o usuário. Ele ainda possui dados associados (corridas/mensagens).' });
    }
    res.status(500).json({ success: false, message: 'Erro interno ao remover o usuário.' });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});