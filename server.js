/* server.fixed.js
   Versão com melhorias de diagnóstico, validação de entradas e handlers globais.
   Substitua seu server.js por este arquivo e reinicie a aplicação no Render.
*/

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

// ROTA curta /app redireciona para /install.html
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'install.html'));
});

// 2. LOG DE PEDIDOS
app.use((req, res, next) => {
  console.log(`--> Recebi pedido para: ${req.method} ${req.url}`);
  next();
});

// 3. ROTA DA PÁGINA INICIAL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- BANCO DE DADOS ---
const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:123456@localhost:5432/falcoes_app';

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('❌ Pool Postgres: erro não tratado', err && err.stack ? err.stack : err);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason && reason.stack ? reason.stack : reason);
});

async function checkDBConnection() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('✅ Conexão com o banco OK');
  } catch (err) {
    console.error(
      '❌ ERRO: Não foi possível conectar ao banco de dados:',
      err && err.message ? err.message : err
    );
  }
}
checkDBConnection();

// --- CRIAÇÃO DAS TABELAS ---
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
  online_ate TIMESTAMP,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
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

    // IMPORTANTE: a tabela real no Render já tem status_exposicao/ciclo com PK (corrida_id, motoboy_id).
    // Aqui apenas garantimos existência, sem mexer na estrutura já criada.
    await pool.query(`
CREATE TABLE IF NOT EXISTS exposicao_corrida (
  id SERIAL PRIMARY KEY,
  corrida_id INTEGER REFERENCES corridas(id),
  motoboy_id INTEGER REFERENCES usuarios(id),
  ciclo INTEGER DEFAULT 1,
  data_exposicao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(corrida_id, motoboy_id)
);
`);

    console.log('✅ Tabelas Verificadas/Criadas!');
  } catch (err) {
    console.error('❌ Erro ao criar tabelas:', err && err.stack ? err.stack : err);
  }
};
initDB();

// --- FUNÇÕES DE DISTRIBUIÇÃO ---

// --- FUNÇÕES DE DISTRIBUIÇÃO CORRIGIDAS (ROUND-ROBIN) ---

async function distribuirCorridaParaMotoboys(corridaId, tipoServico) {
  try {
    let categoriaFiltro = null;

    if (tipoServico === 'moto-taxi') categoriaFiltro = 'Passageiro';
    if (tipoServico === 'entrega') categoriaFiltro = 'Entregas';

    let sql = `
      SELECT u.id
      FROM usuarios u
      LEFT JOIN exposicao_corrida ec
        ON ec.motoboy_id = u.id
       AND ec.corrida_id = $1
      WHERE u.tipo = 'motoboy'
        AND u.aprovado = true
        AND u.online_ate > NOW()
        AND (u.bloqueado_ate IS NULL OR u.bloqueado_ate < NOW())
        AND ec.motoboy_id IS NULL
    `;

    const params = [corridaId];

    if (categoriaFiltro) {
      sql += ` AND (u.categoria = $2 OR u.categoria = 'Geral')`;
      params.push(categoriaFiltro);
    }

    sql += `
      ORDER BY u.id ASC
      LIMIT 1
    `;

    const result = await pool.query(sql, params);

    if (result.rows.length === 0) {
      console.log(`⚠️ Nenhum motoboy elegível para corrida ${corridaId}`);
      return;
    }

    const motoboyId = result.rows[0].id;

    await pool.query(
      `
      INSERT INTO exposicao_corrida (corrida_id, motoboy_id, ciclo)
      VALUES ($1, $2, 1)
      ON CONFLICT (corrida_id, motoboy_id) DO NOTHING
      `,
      [corridaId, motoboyId]
    );

    console.log(`📢 Corrida ${corridaId} enviada para Motoboy ${motoboyId}`);
  } catch (err) {
    console.error(
      'Erro ao distribuir corrida (Round-Robin):',
      err && err.stack ? err.stack : err
    );
  }
}


async function reiniciarCicloCorrida(corridaId) {
  try {
    const corridaCheck = await pool.query(
      'SELECT tipo_servico FROM corridas WHERE id = $1 AND status = \'pendente\'',
      [corridaId]
    );

    if (corridaCheck.rows.length === 0) {
      return;
    }

    console.log(`🔄 Reiniciando ciclo para corrida ${corridaId}`);

    await pool.query(
      `
      UPDATE exposicao_corrida
      SET ciclo = ciclo + 1,
          data_exposicao = CURRENT_TIMESTAMP
      WHERE corrida_id = $1
    `,
      [corridaId]
    );
  } catch (err) {
    console.error('Erro ao reiniciar ciclo:', err && err.stack ? err.stack : err);
  }
}

// --- FUNÇÕES DE MONITORAMENTO CÍCLICO (CORRIGIDO) ---
async function monitorarExpiracoes() {
  try {
    // 1. Encontra corridas PENDENTES no BD
    const corridasPendentes = await pool.query(
      "SELECT id, tipo_servico FROM corridas WHERE status = 'pendente'"
    );

    for (const corrida of corridasPendentes.rows) {
      const corridaId = corrida.id;
      const tipoServico = corrida.tipo_servico;

      // 2. Tenta encontrar UMA exposição expirada para avançar a fila
      const exposicaoExpirada = await pool.query(
        "SELECT corrida_id, motoboy_id " +
        "FROM exposicao_corrida " +
        "WHERE corrida_id = $1 " +
        "  AND EXTRACT(EPOCH FROM (NOW() - data_exposicao)) >= 60 " +
        "ORDER BY data_exposicao ASC " +
        "LIMIT 1",
        [corridaId]
      );

      if (exposicaoExpirada.rows.length > 0) {
        const motoboyExpiradoId = exposicaoExpirada.rows[0].motoboy_id;

        console.log(`[MONITOR] Motoboy ${motoboyExpiradoId} expirou a Corrida ${corridaId}.`);

        // 3. BLOQUEIA O MOTOBOY E REMOVE A EXPOSIÇÃO DELE
        await pool.query(
          'DELETE FROM exposicao_corrida WHERE corrida_id = $1 AND motoboy_id = $2',
          [corridaId, motoboyExpiradoId]
        );
        await pool.query(
          "UPDATE usuarios SET bloqueado_ate = NOW() + interval '10 minutes' WHERE id = $1",
          [motoboyExpiradoId]
        );

        console.log(`[MONITOR] Motoboy ${motoboyExpiradoId} bloqueado por 10 minutos.`);

        // 4. CHAMA A DISTRIBUIÇÃO NOVAMENTE (para o PRÓXIMO motoboy no Round-Robin)
        await distribuirCorridaParaMotoboys(corridaId, tipoServico);
      } else {
        // 5. Se não há exposições expiradas, mas também não há exposições ATIVAS, o ciclo encerrou.
        const exposicoesAtivasCount = await pool.query(
  'SELECT COUNT(*) AS total FROM exposicao_corrida WHERE corrida_id = $1',
  [corridaId]
);


        if (parseInt(exposicoesAtivasCount.rows[0].total, 10) === 0) {
          console.log(`[MONITOR] Ciclo encerrado para Corrida ${corridaId}. Reiniciando.`);

          // 6. Reinicia a lista de exposições (chamando o Round-Robin do zero)
          await reiniciarCicloCorrida(corridaId);
          await distribuirCorridaParaMotoboys(corridaId, tipoServico);
        }
      }
    }
  } catch (err) {
    console.error('❌ ERRO NO MONITORAMENTO CÍCLICO:', err && err.stack ? err.stack : err);
  }
}



// --- ROTAS DO APP ---

app.post('/cadastro', async (req, res) => {
  const { nome, email, senha, tipo, telefone, placa, modelo_moto, cor_moto, categoria } = req.body;

  try {
    const contagem = await pool.query('SELECT COUNT(*) FROM usuarios');
    const totalUsuarios = parseInt(contagem.rows[0].count);

    let estaAprovado = false;
    let tipoFinal = tipo;

    if (totalUsuarios === 0) {
      tipoFinal = 'admin';
      estaAprovado = true;
      console.log('👑 PRIMEIRO USUÁRIO DETECTADO: Criando Admin Supremo.');
    } else {
      estaAprovado = tipo === 'cliente' ? true : false;
    }

    const result = await pool.query(
      'INSERT INTO usuarios (nome, email, senha, tipo, telefone, placa, modelo_moto, cor_moto, categoria, aprovado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      [nome, email, senha, tipoFinal, telefone, placa, modelo_moto, cor_moto, categoria, estaAprovado]
    );

    if (estaAprovado) {
      res.json({ success: true, message: 'Conta Criada com Sucesso!' });
    } else {
      res.json({ success: true, message: 'Cadastro enviado! Aguarde aprovação.' });
    }
  } catch (err) {
    console.error('Erro em /cadastro:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: 'Erro ao cadastrar. Email já existe?' });
  }
});

app.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE email = $1 AND senha = $2',
      [email, senha]
    );
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (user.tipo === 'admin') return res.json({ success: true, user });
      if (!user.aprovado)
        return res.status(401).json({ success: false, message: 'Sua conta está em análise.' });
      res.json({ success: true, user });
    } else {
      res.status(401).json({ success: false, message: 'Email ou senha incorretos.' });
    }
  } catch (err) {
    console.error('Erro em /login:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false, message: 'Erro no servidor' });
  }
});

app.post('/pedir-corrida', async (req, res) => {
  const { cliente_id, origem, destino, valor, tipo_servico } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO corridas (cliente_id, origem, destino, valor, status, tipo_servico) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [cliente_id, origem, destino, valor, 'pendente', tipo_servico]
    );

    await distribuirCorridaParaMotoboys(result.rows[0].id, tipo_servico);

    res.json({ success: true, message: 'Enviado!', id: result.rows[0].id });
  } catch (err) {
    console.error('Erro em /pedir-corrida:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.post('/cancelar-pedido', async (req, res) => {
  const { id, motivo } = req.body;
  try {
    await pool.query(
      "UPDATE corridas SET status = 'cancelada', motivo_cancelamento = $1 WHERE id = $2",
      [motivo, id]
    );
    await pool.query('DELETE FROM exposicao_corrida WHERE corrida_id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /cancelar-pedido:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});


// --- /corridas-pendentes ---

app.post('/corridas-pendentes', async (req, res) => {
  const { motoboy_id } = req.body;
  const TEMPO_LIMITE_SEGUNDOS = 60;

  if (!motoboy_id) return res.status(400).json({ error: 'motoboy_id é obrigatório' });

  try {
    const motoboyQuery = await pool.query(
      'SELECT bloqueado_ate, categoria, online_ate FROM usuarios WHERE id = $1',
      [motoboy_id]
    );
    const motoboy = motoboyQuery.rows[0];

    if (!motoboy) return res.status(404).json({ error: 'Motoboy não encontrado.' });

    if (motoboy.bloqueado_ate && new Date(motoboy.bloqueado_ate) > new Date()) {
      const min = Math.ceil((new Date(motoboy.bloqueado_ate) - new Date()) / 60000);
      return res.json({ success: false, bloqueado: true, tempo: min });
    }

    if (!motoboy.online_ate || new Date(motoboy.online_ate) < new Date()) {
      return res.json({
        success: false,
        offline: true,
        message: 'Você precisa estar online para ver corridas.',
      });
    }

    // --- LÓGICA DE FILTRO CORRIGIDA AQUI ---
    // Aplica o filtro de tipo de serviço se a categoria for específica ('Passageiro' ou 'Entregas').
    // Motoboys 'Geral' verão todos os tipos de corridas distribuídas para eles.
    let tipoServicoFiltro = null;

    if (motoboy.categoria === 'Passageiro') {
        tipoServicoFiltro = 'moto-taxi';
    } else if (motoboy.categoria === 'Entregas') {
        tipoServicoFiltro = 'entrega';
    }
    
    let params = [motoboy_id, TEMPO_LIMITE_SEGUNDOS];
    let tipoClause = '';

    if (tipoServicoFiltro) {
        params.push(tipoServicoFiltro);
        tipoClause = `AND c.tipo_servico = $${params.length}`;
    }
    // --- FIM DA LÓGICA DE FILTRO CORRIGIDA ---


    const sql = `
      SELECT 
        c.id AS corrida_id,
        c.origem,
        c.destino,
        c.valor,
        c.tipo_servico,
        u.nome AS nome_cliente,
        u.telefone AS telefone_cliente,
        EXTRACT(EPOCH FROM (NOW() - ec.data_exposicao)) AS segundos_passados,
        ec.ciclo,
        ec.data_exposicao
      FROM exposicao_corrida ec
      JOIN corridas c ON ec.corrida_id = c.id
      JOIN usuarios u ON c.cliente_id = u.id
      WHERE ec.motoboy_id = $1
        AND c.status = 'pendente'
        AND EXTRACT(EPOCH FROM (NOW() - ec.data_exposicao)) < $2
        ${tipoClause}
      ORDER BY ec.data_exposicao ASC
      LIMIT 1
    `;

    const result = await pool.query(sql, params);

    if (!result.rows || result.rows.length === 0) {
      return res.json({
        success: true,
        corrida: null,
        message: 'Nenhuma corrida disponível no momento.',
      });
    }

    const corrida = result.rows[0];
    return res.json({ success: true, corrida });
  } catch (err) {
    console.error('Erro em /corridas-pendentes:', err && err.stack ? err.stack : err);
    return res
      .status(500)
      .json({ success: false, message: 'Erro ao buscar corridas pendentes.' });
  }
});
// --- /expirar-corrida ---

app.post('/expirar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id } = req.body;
  const TEMPO_BLOQUEIO_MINUTOS = 10;

  if (!corrida_id || !motoboy_id)
    return res.status(400).json({ error: 'corrida_id e motoboy_id são obrigatórios' });

  try {
    // Remove a exposição dessa corrida para este motoboy
    await pool.query(
      'DELETE FROM exposicao_corrida WHERE corrida_id = $1 AND motoboy_id = $2',
      [corrida_id, motoboy_id]
    );

    // Bloqueia o motoboy por 10 minutos
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NOW() + interval '10 minutes' WHERE id = $1",
      [motoboy_id]
    );

    console.log(
      `[EXPIRADO] Motoboy ${motoboy_id} bloqueado por ${TEMPO_BLOQUEIO_MINUTOS} minutos.`
    );

    res.json({ success: true, bloqueado: true, tempo: TEMPO_BLOQUEIO_MINUTOS });
  } catch (err) {
    console.error('Erro em /expirar-corrida:', err && err.stack ? err.stack : err);
    res
      .status(500)
      .json({ success: false, message: 'Erro interno ao processar expiração.' });
  }
});

app.post('/finalizar-corrida', async (req, res) => {
  try {
    await pool.query("UPDATE corridas SET status = 'concluida' WHERE id = $1", [
      req.body.corrida_id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /finalizar-corrida:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.get('/minha-corrida-atual/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT c.*, u.nome AS nome_cliente, u.telefone AS telefone_cliente
      FROM corridas c
      JOIN usuarios u ON c.cliente_id = u.id
      WHERE c.motoboy_id = $1 AND c.status = 'aceita'
    `,
      [req.params.id]
    );
    if (result.rows.length > 0)
      res.json({ tem_corrida: true, corrida: result.rows[0] });
    else res.json({ tem_corrida: false });
  } catch (err) {
    console.error('Erro em /minha-corrida-atual:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.get('/status-pedido/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT c.status,
             u.nome AS nome_motoboy,
             u.telefone AS telefone_motoboy,
             u.modelo_moto,
             u.placa,
             u.cor_moto
      FROM corridas c
      LEFT JOIN usuarios u ON c.motoboy_id = u.id
      WHERE c.id = $1
    `,
      [req.params.id]
    );
    if (result.rows.length > 0)
      res.json({ success: true, pedido: result.rows[0] });
    else res.json({ success: false });
  } catch (err) {
    console.error('Erro em /status-pedido:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.post('/enviar-mensagem', async (req, res) => {
  const { corrida_id, remetente, texto } = req.body;
  if (!corrida_id || !remetente || !texto)
    return res
      .status(400)
      .json({ error: 'corrida_id, remetente e texto são obrigatórios' });
  try {
    await pool.query(
      'INSERT INTO mensagens (corrida_id, remetente, texto) VALUES ($1,$2,$3)',
      [corrida_id, remetente, texto]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /enviar-mensagem:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.get('/mensagens/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM mensagens WHERE corrida_id = $1 ORDER BY data_hora ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /mensagens/:id:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

// --- STATUS ONLINE MOTOBOY ---

app.post('/motoboy/status-online', async (req, res) => {
  const { motoboy_id, online, latitude, longitude } = req.body;

  if (!motoboy_id || typeof online === 'undefined') {
    return res
      .status(400)
      .json({ success: false, message: 'motoboy_id e online são obrigatórios.' });
  }

  const idNum = Number(motoboy_id);
  if (!Number.isFinite(idNum)) {
    return res.status(400).json({ success: false, message: 'motoboy_id inválido.' });
  }

  try {
    const lat =
      latitude === null || latitude === undefined ? null : Number(latitude);
    const lng =
      longitude === null || longitude === undefined ? null : Number(longitude);
    const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lng);

    if (online) {
      if (hasValidCoords) {
        await pool.query(
          `
          UPDATE usuarios SET
            online_ate = NOW() + interval '60 seconds',
            latitude = $2,
            longitude = $3
          WHERE id = $1
        `,
          [idNum, lat, lng]
        );
        console.log(
          `✅ Motoboy ${idNum} ONLINE (coords atualizadas: ${lat}, ${lng})`
        );
      } else {
        await pool.query(
          `
          UPDATE usuarios SET
            online_ate = NOW() + interval '60 seconds'
          WHERE id = $1
        `,
          [idNum]
        );
        console.log(`✅ Motoboy ${idNum} ONLINE (sem coords ou coords inválidas)`);
      }

      return res.json({ success: true, status: 'ONLINE' });
    } else {
      await pool.query('UPDATE usuarios SET online_ate = NULL WHERE id = $1', [
        idNum,
      ]);
      console.log(`🔴 Motoboy ${idNum} OFFLINE`);
      return res.json({ success: true, status: 'OFFLINE' });
    }
  } catch (err) {
    console.error('Erro em /motoboy/status-online:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Erro ao atualizar status.' });
  }
});

// --- ROTAS ADMIN ---

app.get('/admin/dashboard', async (req, res) => {
  try {
    const hoje = await pool.query(
      'SELECT COUNT(*) FROM corridas WHERE data_hora::date = CURRENT_DATE'
    );
    const mes = await pool.query(
      'SELECT COUNT(*) FROM corridas WHERE EXTRACT(MONTH FROM data_hora) = EXTRACT(MONTH FROM CURRENT_DATE)'
    );
    const entregas = await pool.query(
      "SELECT COUNT(*) FROM corridas WHERE tipo_servico = 'entrega'"
    );
    const motoTaxi = await pool.query(
      "SELECT COUNT(*) FROM corridas WHERE tipo_servico = 'moto-taxi'"
    );
    const historico = await pool.query(`
      SELECT c.id, c.origem, c.destino, c.valor, c.tipo_servico, c.status, c.motivo_cancelamento,
             u.nome AS nome_motoboy
      FROM corridas c
      LEFT JOIN usuarios u ON c.motoboy_id = u.id
      ORDER BY c.id DESC
      LIMIT 10
    `);
    res.json({
      total_hoje: hoje.rows[0].count,
      total_mes: mes.rows[0].count,
      qtd_entrega: entregas.rows[0].count,
      qtd_moto: motoTaxi.rows[0].count,
      historico: historico.rows,
    });
  } catch (err) {
    console.error('Erro em /admin/dashboard:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.get('/admin/pendentes', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE aprovado = false AND tipo = 'motoboy' ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erro em /admin/pendentes:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Erro' });
  }
});

app.post('/admin/aprovar', async (req, res) => {
  try {
    await pool.query('UPDATE usuarios SET aprovado = true WHERE id = $1', [
      req.body.id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /admin/aprovar:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.post('/admin/rejeitar', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.body.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /admin/rejeitar:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});

app.get('/admin/motoboys', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nome, email, telefone, placa, modelo_moto, cor_moto, categoria, aprovado,
             CASE WHEN online_ate > NOW() THEN 'Online' ELSE 'Offline' END AS status_online
      FROM usuarios
      WHERE tipo = 'motoboy' AND aprovado = true
      ORDER BY nome ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao buscar motoboys:', err && err.stack ? err.stack : err);
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
    console.error('Erro ao buscar clientes:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Erro ao buscar clientes' });
  }
});

app.delete('/admin/remover/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    const deleteResult = await pool.query(
      'DELETE FROM usuarios WHERE id = $1 RETURNING id',
      [userId]
    );

    if (deleteResult.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'Usuário não encontrado.' });
    }

    res.json({ success: true, message: 'Usuário removido com sucesso.' });
  } catch (err) {
    console.error('Erro ao remover usuário:', err && err.stack ? err.stack : err);
    if (err.code === '23503') {
      return res.status(409).json({
        success: false,
        message:
          'Não é possível remover o usuário. Ele ainda possui dados associados (corridas/mensagens).',
      });
    }
    res
      .status(500)
      .json({ success: false, message: 'Erro interno ao remover o usuário.' });
  }
});

// PROXY NOMINATIM
app.get('/reverse', async (req, res) => {
  try {
    const lat = req.query.lat;
    const lon = req.query.lon;
    if (!lat || !lon) return res.status(400).json({ error: 'missing lat or lon' });

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&zoom=18&addressdetails=1`;

    const r = await fetchFn(nominatimUrl, {
      headers: {
        'User-Agent': 'FalcaoApp/1.0 (seu-email@exemplo.com)',
      },
      timeout: 10000,
    });

    const text = await r.text();
    if (!r.ok) {
      return res.status(r.status).send(text);
    }

    try {
      const json = JSON.parse(text);
      return res.json(json);
    } catch (err) {
      return res.send(text);
    }
  } catch (err) {
    console.error('proxy /reverse error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'proxy failed', details: String(err) });
  }
});

// HEALTH
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('SELECT 1');
    res.json({ ok: true, db: !!r });
  } catch (err) {
    res.status(500).json({ ok: false, dbError: String(err.message || err) });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
// --- INICIALIZAÇÃO DO MONITORAMENTO ---

// Inicia o monitoramento de expirações a cada 5 segundos
// Isso garante que corridas expiradas para todos sejam redistribuídas.
setInterval(monitorarExpiracoes, 5000);