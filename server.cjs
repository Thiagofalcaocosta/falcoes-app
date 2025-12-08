/* server.fixed.js
   Versão com melhorias de diagnóstico, validação de entradas e handlers globais.
   Substitua seu server.js por este arquivo e reinicie a aplicação no Render.
*/

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');

require('dotenv').config();

const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN_TEST
});

const preferenceClient = new Preference(client);



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

async function distribuirCorridaParaMotoboys(corridaId, tipoServico) {
  try {
    let categoriaFiltro = null;

    if (tipoServico === 'moto-taxi') {
      categoriaFiltro = 'Passageiro';
    } else if (tipoServico === 'entrega') {
      categoriaFiltro = 'Entregas';
    }

    let sql;
    let params;

    if (categoriaFiltro) {
      // Com filtro de categoria (Passageiro / Entregas)
      sql =
        'SELECT u.id ' +
        'FROM usuarios u ' +
        'LEFT JOIN exposicao_corrida ec ON ec.motoboy_id = u.id AND ec.corrida_id = $1 ' +
        "WHERE u.tipo = 'motoboy' " +
        'AND u.aprovado = true ' +
        'AND u.online_ate > NOW() ' +
        'AND (u.bloqueado_ate IS NULL OR u.bloqueado_ate < NOW()) ' +
        'AND ec.motoboy_id IS NULL ' +
        'AND (u.categoria = $2 OR u.categoria = \'Geral\') ' +
        'ORDER BY u.id ASC ' +
        'LIMIT 1';
      params = [corridaId, categoriaFiltro];
    } else {
      // Sem filtro de categoria (motoboy "Geral")
      sql =
        'SELECT u.id ' +
        'FROM usuarios u ' +
        'LEFT JOIN exposicao_corrida ec ON ec.motoboy_id = u.id AND ec.corrida_id = $1 ' +
        "WHERE u.tipo = 'motoboy' " +
        'AND u.aprovado = true ' +
        'AND u.online_ate > NOW() ' +
        'AND (u.bloqueado_ate IS NULL OR u.bloqueado_ate < NOW()) ' +
        'AND ec.motoboy_id IS NULL ' +
        'ORDER BY u.id ASC ' +
        'LIMIT 1';
      params = [corridaId];
    }

    // LOG pra ver exatamente a query se ainda der erro
    console.log('SQL distribuição:', sql, 'PARAMS:', params);

    const result = await pool.query(sql, params);

    if (result.rows.length === 0) {
      console.log(`⚠️ Nenhum motoboy elegível para corrida ${corridaId}`);
      return;
    }

    const motoboyId = result.rows[0].id;

    await pool.query(
      'INSERT INTO exposicao_corrida (corrida_id, motoboy_id, ciclo) ' +
      'VALUES ($1, $2, 1) ' +
      'ON CONFLICT (corrida_id, motoboy_id) DO NOTHING',
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
async function monitorarExpiracoes() {
  try {

    // 🛡️ GUARDA-COSTAS: mata corridas zumbis
    await pool.query(`
      UPDATE corridas
      SET status = 'cancelada',
          motivo_cancelamento = '[SYSTEM] Encerrada por timeout'
      WHERE status = 'pendente'
        AND data_hora < NOW() - interval '15 minutes'
    `);

    // 🧹 Remove exposições de corridas que não estão mais pendentes
    await pool.query(`
      DELETE FROM exposicao_corrida
      WHERE corrida_id IN (
        SELECT id FROM corridas WHERE status != 'pendente'
      )
    `);

    // 1. Corridas realmente pendentes
    const corridasPendentes = await pool.query(
      "SELECT id, tipo_servico FROM corridas WHERE status = 'pendente'"
    );

    for (const corrida of corridasPendentes.rows) {
      const corridaId = corrida.id;
      const tipoServico = corrida.tipo_servico;


      // 2. Procurar uma exposição expirada (tempo esgotou)
      const exposicaoExpirada = await pool.query(
        "SELECT corrida_id, motoboy_id " +
          "FROM exposicao_corrida " +
          "WHERE corrida_id = $1 " +
          "  AND EXTRACT(EPOCH FROM (NOW() - data_exposicao)) >= 60 " + // 60s
          "ORDER BY data_exposicao ASC " +
          "LIMIT 1",
        [corridaId]
      );

      if (exposicaoExpirada.rows.length > 0) {
        const motoboyExpiradoId = exposicaoExpirada.rows[0].motoboy_id;

        console.log(
          `[MONITOR] Motoboy ${motoboyExpiradoId} expirou a Corrida ${corridaId}.`
        );

        // 3. SÓ REMOVE A EXPOSIÇÃO (NÃO BLOQUEIA)
        await pool.query(
          "DELETE FROM exposicao_corrida WHERE corrida_id = $1 AND motoboy_id = $2",
          [corridaId, motoboyExpiradoId]
        );

        // 🔁 FORÇA IR PARA O PRÓXIMO
        await distribuirCorridaParaMotoboys(corridaId, tipoServico);


        console.log(
          `[MONITOR] Exposição removida para motoboy ${motoboyExpiradoId}.`
        );

        // 4. Chama distribuição para o PRÓXIMO motoboy
        await distribuirCorridaParaMotoboys(corridaId, tipoServico);
      } else {
        // 5. Não tem expirada. Ver se ainda tem alguém com a corrida exposta
        const exposicoesAtivasCount = await pool.query(
          "SELECT COUNT(*) AS total FROM exposicao_corrida WHERE corrida_id = $1",
          [corridaId]
        );

        const total = parseInt(exposicoesAtivasCount.rows[0].total, 10);

        if (total === 0) {
          console.log(
            `[MONITOR] Nenhuma exposição ativa para Corrida ${corridaId}. Tentando redistribuir.`
          );
          await distribuirCorridaParaMotoboys(corridaId, tipoServico);
        }
      }
    }
  } catch (err) {
    console.error(
      "❌ ERRO NO MONITORAMENTO CÍCLICO:",
      err && err.stack ? err.stack : err
    );
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
    // 1. Cancela a corrida e desvincula o motoboy
    await pool.query(
      `
      UPDATE corridas
      SET status = 'cancelada',
          motivo_cancelamento = $1,
          motoboy_id = NULL
      WHERE id = $2
      `,
      [motivo, id]
    );

    // 2. Remove TODAS as exposições dessa corrida
    await pool.query(
      "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
      [id]
    );

    console.log(`🚫 Corrida ${id} cancelada e exposições limpas.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /cancelar-pedido:', err && err.stack ? err.stack : err);
    res.status(500).json({ success: false });
  }
});


app.post('/corridas-pendentes', async (req, res) => {
  const { motoboy_id } = req.body;
  const TEMPO_LIMITE_SEGUNDOS = 60;

  if (!motoboy_id) {
    return res.status(400).json({ error: 'motoboy_id é obrigatório' });
  }

  try {
    const motoboyResult = await pool.query(
      'SELECT categoria, online_ate, bloqueado_ate FROM usuarios WHERE id = $1',
      [motoboy_id]
    );

    if (motoboyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Motoboy não encontrado.' });
    }

    const motoboy = motoboyResult.rows[0];

    // Bloqueado
    if (motoboy.bloqueado_ate && new Date(motoboy.bloqueado_ate) > new Date()) {
      const minutos = Math.ceil(
  (new Date(motoboy.bloqueado_ate) - new Date()) / 60000
);

return res.json({
  success: false,
  bloqueado: true,
  tempo: minutos,
});

    }

    // Offline
    if (!motoboy.online_ate || new Date(motoboy.online_ate) < new Date()) {
      return res.json({ success: false, offline: true });
    }

    // Categoria do motoboy (Geral, Passageiro, Entregas)
    const categoria = motoboy.categoria || 'Geral';

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
      JOIN corridas c ON c.id = ec.corrida_id
      JOIN usuarios u ON u.id = c.cliente_id
      WHERE ec.motoboy_id = $1
        AND c.status = 'pendente'
        AND EXTRACT(EPOCH FROM (NOW() - ec.data_exposicao)) < $2
        AND (
          $3 = 'Geral'
          OR ($3 = 'Passageiro' AND c.tipo_servico = 'moto-taxi')
          OR ($3 = 'Entregas' AND c.tipo_servico = 'entrega')
        )
      ORDER BY ec.data_exposicao ASC
      LIMIT 1
    `;

    const params = [motoboy_id, TEMPO_LIMITE_SEGUNDOS, categoria];

    const result = await pool.query(sql, params);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        corrida: null,
        message: 'Nenhuma corrida disponível no momento.',
      });
    }

    return res.json({ success: true, corrida: result.rows[0] });
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

  if (!corrida_id || !motoboy_id) {
    return res.status(400).json({ error: 'corrida_id e motoboy_id são obrigatórios' });
  }

  try {
    
    // ✅ Marca que já expirou para esse motoboy,
//    sem apagar o registro (pra não voltar pra ele)
await pool.query(
  `
  UPDATE exposicao_corrida
  SET data_exposicao = NOW() - interval '120 seconds'
  WHERE corrida_id = $1
    AND motoboy_id = $2
  `,
  [corrida_id, motoboy_id]
);


    console.log(`⏭️ Corrida ${corrida_id} expirou para motoboy ${motoboy_id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro em /expirar-corrida:', err);
    res.status(500).json({ success: false });
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
      SELECT
        c.id,                        -- ID da corrida
        c.status,                    -- status da corrida
        c.valor_total,               -- VALOR da corrida (ajuste o nome se for diferente)
        u.nome       AS nome_motoboy,
        u.telefone   AS telefone_motoboy,
        u.modelo_moto,
        u.placa,
        u.cor_moto
      FROM corridas c
      LEFT JOIN usuarios u ON c.motoboy_id = u.id
      WHERE c.id = $1
      `,
      [req.params.id]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, pedido: result.rows[0] });
    } else {
      res.json({ success: false });
    }
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
    // 🔹 LIMPA BLOQUEIO VENCIDO
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NULL WHERE id = $1 AND bloqueado_ate < NOW()",
      [idNum]
    );

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

app.post('/aceitar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id } = req.body;

  if (!corrida_id || !motoboy_id) {
    return res.status(400).json({ error: 'corrida_id e motoboy_id são obrigatórios' });
  }

  try {
    // 1️⃣ Tenta aceitar APENAS se ainda estiver pendente
    const result = await pool.query(
      `
      UPDATE corridas
      SET status ='AGUARDANDO_PAGAMENTO' ,
          motoboy_id = $2
      WHERE id = $1
        AND status = 'pendente'
      RETURNING id
      `,
      [corrida_id, motoboy_id]
    );

    if (result.rowCount === 0) {
      return res.json({
        success: false,
        message: 'Corrida não está mais disponível',
      });
    }

    // 2️⃣ Remove da fila (ninguém mais vê)
    await pool.query(
      "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
      [corrida_id]
    );

    console.log(`✅ Corrida ${corrida_id} aceita pelo motoboy ${motoboy_id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao aceitar corrida:', err);
    res.status(500).json({ success: false });
  }
});
app.post('/motoboy-cancelar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id, motivo } = req.body;

  if (!corrida_id || !motoboy_id) {
    return res.status(400).json({ error: 'Dados obrigatórios faltando' });
  }

  try {
    // 1️⃣ Cancela a corrida
    await pool.query(
      `
      UPDATE corridas
      SET status = 'cancelada',
          motivo_cancelamento = $3,
          motoboy_id = NULL
      WHERE id = $1 AND motoboy_id = $2
      `,
      [corrida_id, motoboy_id, motivo || 'Cancelada pelo motoboy']
    );

    // 2️⃣ Limpa fila
    await pool.query(
      "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
      [corrida_id]
    );

    // 3️⃣ ✅ AQUI SIM PUNE (leve)
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NOW() + interval '2 minutes' WHERE id = $1",
      [motoboy_id]
    );

    console.log(`⚠️ Motoboy ${motoboy_id} cancelou corrida ${corrida_id}`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao cancelar corrida pelo motoboy:', err);
    res.status(500).json({ success: false });
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
// ===============================================
// PAGAMENTO DE CORRIDA (ONLINE ou DINHEIRO)
// ===============================================
app.post('/pagar-corrida', async (req, res) => {
  try {
    const { corridaId, valor, forma } = req.body;

    if (!corridaId || !valor || !forma) {
      return res.status(400).json({ erro: 'corridaId, valor e forma são obrigatórios' });
    }

    // Por enquanto só mostramos no log o que foi pedido
    console.log('Pagamento solicitado:', { corridaId, valor, forma });

    if (forma === 'ONLINE') {
      // Cria preferência no Mercado Pago (modo TESTE)
      const response = await preferenceClient.create({
        body: {
          items: [
            {
              title: `Corrida #${corridaId}`,
              quantity: 1,
              currency_id: 'BRL',
              unit_price: Number(valor)
            }
          ],
          external_reference: String(corridaId)
        }
      });

      // Retorna link de pagamento (SANDBOX por enquanto)
      return res.json({
        ok: true,
        tipo: 'ONLINE',
        sandbox_init_point: response.sandbox_init_point
      });
    }

    if (forma === 'DINHEIRO') {
      // FUTURO: aqui vamos atualizar no banco:
      // - forma_pagamento = 'DINHEIRO'
      // - status_pagamento = 'PAGAMENTO_PENDENTE_DINHEIRO'
      //
      // Exemplo (NÃO DESCOMENTE AGORA):
      // await pool.query(
      //   'UPDATE corridas SET forma_pagamento = $1, status_pagamento = $2 WHERE id = $3',
      //   ['DINHEIRO', 'PAGAMENTO_PENDENTE_DINHEIRO', corridaId]
      // );

      return res.json({
        ok: true,
        tipo: 'DINHEIRO',
        mensagem: 'Pagamento em dinheiro registrado. Pague ao motoboy.'
      });
    }

    return res.status(400).json({ erro: 'Forma de pagamento inválida (use ONLINE ou DINHEIRO).' });

  } catch (err) {
    console.error('ERRO PAGAR-CORRIDA:', err);
    return res.status(500).json({ erro: 'Erro ao iniciar pagamento.' });
  }
});


app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
// --- INICIALIZAÇÃO DO MONITORAMENTO ---

// Inicia o monitoramento de expirações a cada 5 segundos
// Isso garante que corridas expiradas para todos sejam redistribuídas.
setInterval(monitorarExpiracoes, 5000);


app.get('/pagar-teste', async (req, res) => {
  try {
    const response = await preferenceClient.create({
      body: {
        items: [
          {
            title: 'Teste Mercado Pago PIX',
            quantity: 1,
            currency_id: 'BRL',
            unit_price: 10
          }
        ]
      }
    });

    res.json({
      sandbox_init_point: response.sandbox_init_point
    });

  } catch (err) {
    console.error('ERRO MP:', err);
    res.status(500).json({ erro: err.message });
  }
});
