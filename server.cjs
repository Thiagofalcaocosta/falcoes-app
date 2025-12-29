/* 
   Versão completa com Mercado Pago e correção de ordem
*/
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');


const PUBLIC_BASE_URL = 'https://falcoes-app.onrender.com';
const FRONT_URL = 'https://falcoes.site';

const { MercadoPagoConfig, Preference, Payment, MerchantOrder } = require('mercadopago');

// ===============================================
// 3. DECLARAR O APP EXPRESS
// ===============================================
const app = express();
const port = process.env.PORT || 3000;

// ==================================================================
// 🚨 CORREÇÃO URGENTE: ISSO TEM QUE SER A PRIMEIRA COISA (TOPO) 🚨
// ==================================================================
// ==================================================================
// ✅ FORMA CORRETA E LIMPA USANDO O PACOTE 'CORS'
// ==================================================================
app.use(cors({
    origin: '*', // Permite todas as origens (ou use 'https://falcoes.site' para mais segurança)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
// 3A. CONFIGURAÇÃO MERCADO PAGO
const mpAccessToken = process.env.MP_ACCESS_TOKEN_TEST || process.env.MP_ACCESS_TOKEN;

if (!mpAccessToken) {
  console.error('❌ Nenhum access token do Mercado Pago encontrado.');
  console.error('Configure MP_ACCESS_TOKEN_TEST nas variáveis de ambiente do Render.');
}
// === CLIENTES MP ===
const mpClient = new MercadoPagoConfig({
  accessToken: mpAccessToken,
  options: { 
    timeout: 5000,
    
  }
});

const preferenceClient     = new Preference(mpClient);
const paymentClient        = new Payment(mpClient);
const merchantOrderClient  = new MerchantOrder(mpClient);



// ===============================================
// 4. MIDDLEWARES (CORREÇÃO DO BLOQUEIO CORS)
// ===============================================

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// SUBSTITUA A LINHA "app.use(cors())" ANTIGA POR ISSO:
app.use(cors({
    origin: '*', // Libera para qualquer site (resolve o erro vermelho)
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
// ===============================================
// 🛡️ SEGURANÇA: BLOQUEIO DE ARQUIVOS SENSÍVEIS
// ===============================================
app.use((req, res, next) => {
    // Lista de arquivos que NINGUÉM pode baixar
    const arquivosProibidos = [
        '/database.db',
        '/server.cjs',
        '/server.fixed.js',
        '/package.json',
        '/package-lock.json',
        '/.env',
        '/.git',
        '/.gitignore'
    ];

    // Se a URL solicitada for exatamente um arquivo proibido
    if (arquivosProibidos.includes(req.path)) {
        console.log(`🚨 Tentativa de invasão bloqueada: IP ${req.ip} tentou baixar ${req.path}`);
        return res.status(403).send('⛔ Acesso Negado: Área Restrita.');
    }

    // Bloqueia qualquer arquivo que termine com .db ou .sqlite (garantia extra)
    if (req.path.endsWith('.db') || req.path.endsWith('.sqlite')) {
        return res.status(403).send('⛔ Acesso Negado.');
    }

    next(); // Se não for proibido, deixa passar
});

// ===============================================
// AGORA SIM: SERVIR ARQUIVOS ESTÁTICOS
// ===============================================
app.use(express.static(path.join(__dirname))); // <-- Essa linha já existe no seu código, o bloqueio fica ACIMA dela
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 1. SERVIR ARQUIVOS ESTÁTICOS (CSS, IMAGENS, JS)
app.use(express.static(path.join(__dirname)));
app.use('/assets', express.static(path.join(__dirname, 'assets')));


// ===============================================
// 5. CONFIGURAÇÃO DO BANCO DE DADOS
// ===============================================

// suporte a fetch no Node: usa global fetch (Node >=18) ou node-fetch (Node <18)
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (e) {
    console.warn('node-fetch não instalado — instale com: npm install node-fetch@2');
  }
}
// --- COPIE DAQUI ---

// 1. Primeiro definimos a variável (Isso é o que estava faltando!)
const connectionString = process.env.DATABASE_URL;

// 2. Depois criamos a conexão usando ela
const pool = new Pool({
  connectionString: connectionString,
  ssl: false, 
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// --- ATÉ AQUI ---

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

// ===============================================
// 6. CRIAÇÃO DAS TABELAS
// ===============================================

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
  foto_rosto VARCHAR(255),
  mp_preference_id VARCHAR(255)
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
  mp_preference_id VARCHAR(255),
  data_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);
    // ✅ GARANTE COLUNA forma_pagamento
    await pool.query(`
      ALTER TABLE corridas
      ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(20);
    `);


    // ✅ GARANTE COLUNA mp_preference_id EM BANCOS ANTIGOS
    await pool.query(`
      ALTER TABLE corridas
      ADD COLUMN IF NOT EXISTS mp_preference_id VARCHAR(255);
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

// ===============================================
// 7. FUNÇÕES AUXILIARES
// ===============================================
// Substitua a função distribuirCorridaParaMotoboys atual por esta:
async function distribuirCorridaParaMotoboys(corridaId, tipoServico) {
  try {
    // 1. Mapeamento rigoroso baseado nas categorias da sua imagem
    let categoriaNecessaria = null;
    if (tipoServico === 'moto-taxi') categoriaNecessaria = 'Passageiro';
    if (tipoServico === 'entrega') categoriaNecessaria = 'Entregas';

    // Se o serviço não for identificado, não distribui para evitar erros
    if (!categoriaNecessaria) {
      console.log(`❌ Tipo de serviço [${tipoServico}] não reconhecido para distribuição.`);
      return 0;
    }

    const sql = `
      SELECT u.id 
      FROM usuarios u 
      WHERE u.tipo = 'motoboy' 
        AND u.aprovado = true 
        AND u.online_ate > NOW()
        AND (u.bloqueado_ate IS NULL OR u.bloqueado_ate < NOW())
        
        -- Filtra EXATAMENTE pela categoria do motoboy (Entregas ou Passageiro)
        AND u.categoria = $2
        
        -- 1. GARANTE QUE O MOTOBOY ESTÁ LIVRE (Sem corrida ativa aceita)
        AND NOT EXISTS (
            SELECT 1 FROM corridas c 
            WHERE c.motoboy_id = u.id 
            AND c.status IN ('aguardando_pagamento', 'liberada', 'em_andamento')
        )
        
        -- 2. GARANTE QUE ELE NÃO ESTÁ VENDO OUTRA OFERTA AGORA (Foco total)
        AND NOT EXISTS (
            SELECT 1 FROM exposicao_corrida ec2 
            WHERE ec2.motoboy_id = u.id
        )

        -- 3. GARANTE QUE NÃO REPETE A MESMA CORRIDA QUE ELE JÁ DEIXOU EXPIRAR
        AND NOT EXISTS (
            SELECT 1 FROM exposicao_corrida ec 
            WHERE ec.motoboy_id = u.id AND ec.corrida_id = $1
        )
      ORDER BY RANDOM() 
      LIMIT 1
    `;

    const params = [corridaId, categoriaNecessaria];
    const result = await pool.query(sql, params);

    if (result.rows.length === 0) {
      console.log(`⚠️ Nenhum motoboy [${categoriaNecessaria}] livre para corrida ${corridaId}`);
      return 0;
    }

    const motoboyId = result.rows[0].id;

    // Limpeza de segurança: garante que a tela dele está limpa antes da nova oferta
    await pool.query('DELETE FROM exposicao_corrida WHERE motoboy_id = $1', [motoboyId]);

    // Envia a corrida para o motoboy selecionado
    await pool.query(
      'INSERT INTO exposicao_corrida (corrida_id, motoboy_id, ciclo) VALUES ($1, $2, 1)',
      [corridaId, motoboyId]
    );

    console.log(`🚀 [iFood Mode] Corrida ${corridaId} tocando apenas para ${categoriaNecessaria} (ID: ${motoboyId})`);
    return 1;

  } catch (err) {
    console.error('Erro na distribuição exclusiva:', err);
    return 0;
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

      // 2. Verificar se todos os motoboys já expiraram ou se ainda há alguém
      const exposicoesAtivas = await pool.query(
        `
        SELECT COUNT(*) as total,
               SUM(CASE WHEN EXTRACT(EPOCH FROM (NOW() - data_exposicao)) >= 60 THEN 1 ELSE 0 END) as expirados
        FROM exposicao_corrida 
        WHERE corrida_id = $1
        `,
        [corridaId]
      );

      const totalExposicoes = parseInt(exposicoesAtivas.rows[0].total, 10);
      const totalExpirados = parseInt(exposicoesAtivas.rows[0].expirados, 10);

      if (totalExposicoes === 0) {
        // Nenhuma exposição ativa - redistribuir
        console.log(`[MONITOR] Nenhuma exposição ativa para Corrida ${corridaId}. Redistribuindo...`);
        await distribuirCorridaParaMotoboys(corridaId, tipoServico);
      } else if (totalExpirados === totalExposicoes && totalExposicoes > 0) {
        // TODOS os motoboys expiraram - limpar e redistribuir
        console.log(`[MONITOR] Todos os ${totalExposicoes} motoboys expiraram para Corrida ${corridaId}. Limpando e redistribuindo...`);
        
        // Limpar todas as exposições
        await pool.query(
          "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
          [corridaId]
        );
        
        // Redistribuir para NOVOS motoboys
        await distribuirCorridaParaMotoboys(corridaId, tipoServico);
      }
      // Se houver pelo menos um motoboy ainda com tempo, não faz nada
    }
  } catch (err) {
    console.error("❌ ERRO NO MONITORAMENTO CÍCLICO:", err && err.stack ? err.stack : err);
  }
}

// ===============================================
// 8. ROTAS DE PÁGINAS ESTÁTICAS
// ===============================================

// 3. ROTA DA PÁGINA INICIAL
app.get('/', (req, res) => {
  res.json({ 
    app: 'Falcões API', 
    status: 'online', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

app.get('/install', (req, res) => {
  res.sendFile(path.join(__dirname, 'install.html'));
});

// ===============================================
// 9. ROTAS DO APP
// ===============================================

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

app.post('/escolher-pagamento', async (req, res) => {
  try {
    const { id, forma_pagamento } = req.body;

    if (!id || !forma_pagamento) {
      return res.status(400).json({ success: false, message: 'Dados inválidos' });
    }

    // 💰 PAGAMENTO EM DINHEIRO
    if (forma_pagamento === 'DINHEIRO') {
      const result = await pool.query(
        "UPDATE corridas SET forma_pagamento = 'DINHEIRO', status = 'liberada' WHERE id = $1 AND status = 'aguardando_pagamento'",
        [id]
      );
      return res.json({ success: true, tipo: 'DINHEIRO' });
    }

    // 🔁 PIX (Integração Real)
    if (forma_pagamento === 'PIX') {
      // 1. Busca o valor da corrida no banco
      const corridaRes = await pool.query("SELECT valor FROM corridas WHERE id = $1", [id]);
      if (corridaRes.rowCount === 0) return res.status(404).json({ success: false });
      const valorTotal = parseFloat(corridaRes.rows[0].valor);

      // 2. Cria o pagamento no Mercado Pago
      const paymentResponse = await paymentClient.create({
        body: {
          transaction_amount: valorTotal,
          description: `Corrida Falcões #${id}`,
          payment_method_id: 'pix',
          payer: {
            email: 'cliente@falcoes.com' // Pode ser dinâmico se tiver no banco
          },
          external_reference: id.toString(),
          notification_url: `${PUBLIC_BASE_URL}/mp-webhook` // Usa sua variável de URL
        }
      });

      const pointOfInteraction = paymentResponse.point_of_interaction.transaction_data;

      // 3. Atualiza o banco com o ID da forma de pagamento
      await pool.query(
        "UPDATE corridas SET forma_pagamento = 'PIX' WHERE id = $1",
        [id]
      );

      // 4. Retorna os dados do QR Code para o frontend
      return res.json({
        success: true,
        tipo: 'PIX',
        pix_copia_cola: pointOfInteraction.qr_code,
        pix_qr_64: pointOfInteraction.qr_code_base64
      });
    }

    return res.status(400).json({ success: false, message: 'Forma inválida' });
  } catch (err) {
    console.error('Erro ao gerar Pix:', err);
    res.status(500).json({ success: false, message: 'Erro ao processar Pix' });
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

    // 3️⃣ ✅ AQUI SIM PUNE (Atualizado para 5 minutos)
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NOW() + interval '5 minutes' WHERE id = $1",
      [motoboy_id]
    );

    console.log(`⚠️ Motoboy ${motoboy_id} cancelou corrida ${corrida_id} e foi bloqueado por 5 min.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao cancelar corrida pelo motoboy:', err);
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
      LIMIT 1 --
    `;

    const params = [motoboy_id, TEMPO_LIMITE_SEGUNDOS, categoria];
    const result = await pool.query(sql, params);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        corridas: [], // Retorna array vazio
        message: 'Nenhuma corrida disponível no momento.',
      });
    }

    // Retorna TODAS as corridas encontradas, não apenas a primeira [0]
    return res.json({ success: true, corridas: result.rows });
  } catch (err) {
    console.error('Erro em /corridas-pendentes:', err && err.stack ? err.stack : err);
    return res
      .status(500)
      .json({ success: false, message: 'Erro ao buscar corridas pendentes.' });
  }
});

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
    const { corrida_id, motoboy_id, codigo_seguranca } = req.body;

    try {
        await pool.query('BEGIN');

        // 1. BUSCA DADOS E VALIDA SE O MOTOBOY É O DONO DA CORRIDA
        const dadosCorrida = await pool.query(
            "SELECT valor, forma_pagamento, codigo_seguranca, motoboy_id FROM corridas WHERE id = $1", 
            [corrida_id]
        );
        
        if (dadosCorrida.rows.length === 0) {
            await pool.query('ROLLBACK');
            return res.json({ success: false, message: "Corrida não encontrada." });
        }

        const dados = dadosCorrida.rows[0];

        // 🛡️ VALIDAÇÃO DE PROPRIEDADE: O motoboy da requisição é o mesmo da corrida?
        if (Number(dados.motoboy_id) !== Number(motoboy_id)) {
    await pool.query('ROLLBACK');
    return res.status(403).json({ success: false, message: "🚫 Esta corrida não pertence a você!" });
}


        // 🛡️ VALIDAÇÃO DE SENHA (CÓDIGO PIN)
        if (dados.codigo_seguranca) {
    if (!codigo_seguranca || String(dados.codigo_seguranca) !== String(codigo_seguranca)) {
        await pool.query('ROLLBACK');
        // Importante manter o status 403 aqui para o log do navegador te avisar
        return res.status(403).json({ success: false, message: "🚫 SENHA INCORRETA! Peça novamente ao cliente." });
    }
}

        const valorTotal = parseFloat(dados.valor);
        const formaPgto = dados.forma_pagamento; 
        const taxaAdmin = 0.15; 
        const valorTaxa = valorTotal * taxaAdmin;
        const valorLiquido = valorTotal - valorTaxa;

        // 2. ATUALIZA SALDO APENAS DO MOTOBOY CORRETO
        if (formaPgto === 'DINHEIRO') {
            await pool.query(
                "UPDATE usuarios SET saldo = COALESCE(saldo, 0) - $1 WHERE id = $2", 
                [valorTaxa, motoboy_id]
            );
        } else {
            await pool.query(
                "UPDATE usuarios SET saldo = COALESCE(saldo, 0) + $1 WHERE id = $2", 
                [valorLiquido, motoboy_id]
            );
        }

        // 3. FINALIZA A CORRIDA ACEITANDO 'liberada' OU 'em_andamento'
const finaliza = await pool.query(
    "UPDATE corridas SET status = 'concluida' WHERE id = $1 AND (status = 'em_andamento' OR status = 'liberada') AND motoboy_id = $2", 
    [corrida_id, motoboy_id]
);

        if (finaliza.rowCount === 0) {
            await pool.query('ROLLBACK');
            return res.json({ success: false, message: "Erro: Corrida já finalizada ou inválida." });
        }

        await pool.query('COMMIT');
        res.json({ success: true, forma: formaPgto, taxa: valorTaxa });

    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Erro ao finalizar:', err);
        res.status(500).json({ success: false, message: "Erro no servidor" });
    }
});

app.get('/minha-corrida-atual/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT c.*, u.nome AS nome_cliente, u.telefone AS telefone_cliente
      FROM corridas c
      JOIN usuarios u ON c.cliente_id = u.id
      WHERE c.motoboy_id = $1
      -- ADICIONEI 'cancelada' AQUI PARA O MOTOBOY RECEBER O DADO ANTES DE SUMIR DA TELA
      AND c.status IN ('aguardando_pagamento', 'liberada', 'em_andamento', 'cancelada')
      ORDER BY c.id DESC LIMIT 1
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
// Rota essencial para o Painel da Empresa funcionar
app.get('/pedidos-cliente/:id', async (req, res) => {
    const clienteId = req.params.id;
    try {
        // Busca todos os pedidos onde o cliente_id é igual ao ID da empresa logada
        const result = await pool.query(
            'SELECT * FROM corridas WHERE cliente_id = $1 ORDER BY id DESC',
            [clienteId]
        );

        res.json({
            success: true,
            pedidos: result.rows
        });
    } catch (err) {
        console.error('Erro ao buscar pedidos da empresa:', err);
        res.status(500).json({ success: false, message: 'Erro no servidor ao buscar lista' });
    }
});

app.get('/status-pedido/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT 
        c.id,
        c.status,
        c.valor,
        c.codigo_seguranca,
        u.nome AS nome_motoboy,
        u.telefone AS telefone_motoboy,
        u.modelo_moto,
        u.placa
      FROM corridas c
      LEFT JOIN usuarios u ON c.motoboy_id = u.id
      WHERE c.id = $1
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false });
    }

    res.json({
      success: true,
      pedido: result.rows[0]
    });

  } catch (err) {
    console.error('Erro em /status-pedido:', err);
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
    const result = await pool.query(
      `
      UPDATE corridas
      SET status = 'aguardando_pagamento',
          motoboy_id = $2
      WHERE id = $1
        AND status = 'pendente'
        -- TRAVA: Só deixa aceitar se o motoboy NÃO tiver outra corrida ativa
        AND NOT EXISTS (
            SELECT 1 FROM corridas 
            WHERE motoboy_id = $2 
            AND status IN ('aguardando_pagamento', 'liberada', 'em_andamento')
        )
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

    await pool.query(
      "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
      [corrida_id]
    );

    console.log(`✅ Motoboy ${motoboy_id} aceitou corrida ${corrida_id}`);

    res.json({ success: true });

  } catch (err) {
    console.error('Erro ao aceitar corrida:', err);
    res.status(500).json({ success: false });
  }
});

// 🔒 INICIAR CORRIDA (BLOQUEADO ATÉ PAGAMENTO)
app.post('/iniciar-corrida', async (req, res) => {
  const { corrida_id, motoboy_id } = req.body;

  if (!corrida_id || !motoboy_id) {
    return res.status(400).json({
      success: false,
      message: 'corrida_id e motoboy_id são obrigatórios'
    });
  }

  try {
    // 1️⃣ Busca status atual
    const result = await pool.query(
      `SELECT status FROM corridas WHERE id = $1 AND motoboy_id = $2`,
      [corrida_id, motoboy_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Corrida não encontrada para este motoboy'
      });
    }

    const statusAtual = result.rows[0].status;

    // 2️⃣ BLOQUEIO FORTE
    if (statusAtual !== 'liberada') {
      return res.status(403).json({
        success: false,
        message: '⏳ Aguardando pagamento do cliente'
      });
    }

    // 3️⃣ Libera início
    await pool.query(
      `UPDATE corridas SET status = 'em_andamento' WHERE id = $1`,
      [corrida_id]
    );

    console.log(`▶️ Corrida ${corrida_id} iniciada pelo motoboy ${motoboy_id}`);

    return res.json({
      success: true,
      message: 'Corrida iniciada com sucesso'
    });

  } catch (err) {
    console.error('Erro em /iniciar-corrida:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao iniciar corrida'
    });
  }
});


// --- ROTA CORRIGIDA PARA CANCELAMENTO (COM PUNIÇÃO DE 5 MIN) ---
app.post('/cancelar-pedido', async (req, res) => {
  // O Frontend envia 'id', então precisamos ler 'id' aqui, não 'corrida_id'
  const { id, motoboy_id, motivo, cancelado_por } = req.body;

  // Verificação de segurança
  if (!id) {
    return res.status(400).json({ error: 'ID da corrida obrigatório' });
  }

  try {
    // 1️⃣ Cancela a corrida
    // Mantemos o motoboy_id na corrida (sem setar NULL) para manter registro de quem cancelou
    await pool.query(
      `
      UPDATE corridas
      SET status = 'cancelada',
          motivo_cancelamento = $1
      WHERE id = $2
      `,
      [motivo || 'Cancelada pelo motoboy', id]
    );

    // 2️⃣ Limpa fila de exposição (tira a corrida da tela dos outros)
    await pool.query(
      "DELETE FROM exposicao_corrida WHERE corrida_id = $1",
      [id]
    );

    // 3️⃣ ✅ PUNIÇÃO DE 5 MINUTOS (Correção aplicada aqui)
    if (motoboy_id) {
        await pool.query(
          "UPDATE usuarios SET bloqueado_ate = NOW() + interval '5 minutes' WHERE id = $1",
          [motoboy_id]
        );
        console.log(`🔒 Motoboy ${motoboy_id} bloqueado por 5 min após cancelar corrida ${id}`);
    }

    console.log(`🚫 Corrida ${id} cancelada com sucesso.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Erro ao cancelar corrida:', err);
    res.status(500).json({ success: false, message: "Erro no servidor" });
  }
});

app.get('/admin/pendentes', async (req, res) => {
  try {
    // MUDANÇA AQUI: Agora ele busca quem é motoboy OU empresa
    const result = await pool.query(
      "SELECT * FROM usuarios WHERE aprovado = false AND (tipo = 'motoboy' OR tipo = 'empresa') ORDER BY id DESC"
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
      SELECT id, nome, email, telefone, placa, modelo_moto, cor_moto, categoria, aprovado, saldo,
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

// ... CONTINUAÇÃO DO CÓDIGO ANTERIOR ...

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

// PAGAMENTO ONLINE - MERCADO PAGO (SDK NOVO)
app.post('/pagar-corrida', async (req, res) => {
  console.log('[/pagar-corrida] body recebido:', req.body);

  try {
    const { corridaId, valor, forma } = req.body;

    if (!corridaId || !valor) {
      return res.status(400).json({
        erro: 'corridaId e valor são obrigatórios.'
      });
    }

    if (forma === 'DINHEIRO') {
      // ⚠️ PARA DINHEIRO: mantém como 'aceita' mas registra que pagamento será em dinheiro
      await pool.query(
        `
        UPDATE corridas
        SET status = 'liberada',
    forma_pagamento = 'DINHEIRO'

        WHERE id = $1
        `,
        [corridaId]
      );

      return res.json({
        sucesso: true,
        mensagem: 'Pagamento em dinheiro registrado. Combine com o motoboy.'
      });
    }

    // Resto do código do Mercado Pago permanece igual...
    // ... (seu código atual do Mercado Pago aqui)
    
  } catch (err) {
    console.error('❌ Erro em /pagar-corrida:', err);
    return res.status(500).json({
      erro: 'Erro ao processar pagamento.',
      detalhe: err.message
    });
  }
});

// WEBHOOK DO MERCADO PAGO
// WEBHOOK DO MERCADO PAGO – confirma pagamento automático
app.post('/mp-webhook', async (req, res) => {
  try {
    console.log('🔔 Webhook Mercado Pago recebido: query=', req.query, 'body=', req.body);

    // Onde estava const id = req.query.id... coloque assim:
const id = req.query.id || (req.body.data && req.body.data.id) || req.body.id;
const topic = req.query.topic || req.query.type || req.body.type;

    if (!topic || !id) {
      console.warn('Webhook sem topic/id válido:', req.query);
      return res.status(400).send('missing topic/id');
    }

    let paymentData = null;

    if (topic === 'payment') {
      // pagamento direto
      paymentData = await paymentClient.get({ id });
    } else if (topic === 'merchant_order') {
      const order = await merchantOrderClient.get({ merchantOrderId: id });
      // pega primeiro pagamento da ordem
      if (order.payments && order.payments.length > 0) {
        const payId = order.payments[0].id;
        paymentData = await paymentClient.get({ id: payId });
      }
    } else {
      console.log('Topic não tratado:', topic);
      return res.status(200).send('ignored');
    }

    if (!paymentData) {
      console.warn('Nenhum paymentData encontrado no webhook.');
      return res.status(200).send('no payment');
    }

    console.log('🔎 paymentData.status =', paymentData.status);
    console.log('🔎 paymentData.external_reference =', paymentData.external_reference);
    console.log('🔎 paymentData.metadata =', paymentData.metadata);

    const corridaId =
      paymentData.external_reference ||
      (paymentData.metadata && (paymentData.metadata.corridaId || paymentData.metadata.corrida_id));

    if (!corridaId) {
      console.warn('Webhook sem corridaId identificável.');
      return res.status(200).send('no corridaId');
    }

    let novoStatus = null;

    if (paymentData.status === 'approved') {
      novoStatus = 'liberada';
    } else if (paymentData.status === 'rejected' || paymentData.status === 'cancelled') {
      novoStatus = 'cancelada';
    }

    if (novoStatus) {
      await pool.query(
        "UPDATE corridas SET status = $1 WHERE id = $2",
        [novoStatus, corridaId]
      );
      console.log(`✅ Webhook: Corrida ${corridaId} atualizada para ${novoStatus}`);
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err && err.stack ? err.stack : err);
    return res.status(500).send('Erro interno');
  }
});


// RETORNO DO MERCADO PAGO
app.get('/mp-retorno', async (req, res) => {
  try {
    console.log('🔁 Retorno Mercado Pago:', req.query);

    const { payment_id, external_reference } = req.query;

    if (!payment_id) {
      return res.redirect('/cliente.html');
    }

    // Confere o pagamento direto no Mercado Pago (segurança)
    const payment = await paymentClient.get({ id: payment_id });

    const status = payment.status;
    const corridaId = payment.external_reference || external_reference;

    console.log('🔎 status final MP =', status, 'corridaId =', corridaId);

    if (status === 'approved' && corridaId) {
      await pool.query(
        `
        UPDATE corridas
        SET status = 'liberada',
            forma_pagamento = 'ONLINE'
        WHERE id = $1
        `,
        [corridaId]
      );

      console.log(`✅ Corrida ${corridaId} liberada via retorno MP`);
    }

    // Sempre volta pro app
    return res.redirect('/cliente.html');

  } catch (err) {
    console.error('❌ Erro no retorno Mercado Pago:', err);
    return res.redirect('/cliente.html');
  }
});

// ROTA PARA VERIFICAR STATUS DO PAGAMENTO
app.get('/verificar-pagamento/:corridaId', async (req, res) => {
  try {
    const { corridaId } = req.params;
    
    const corridaResult = await pool.query(
      "SELECT id, status, mp_preference_id FROM corridas WHERE id = $1",
      [corridaId]
    );
    
    if (corridaResult.rows.length === 0) {
      return res.status(404).json({ erro: 'Corrida não encontrada' });
    }
    
    const corrida = corridaResult.rows[0];
    
    // Se tiver preference_id, buscar status atual no MP
    if (corrida.mp_preference_id) {
      try {
        const preference = await preferenceClient.get({
          id: corrida.mp_preference_id
        });
        
        return res.json({
          status: corrida.status,
          mercado_pago_status: preference.status,
          init_point: preference.init_point
        });
      } catch (mpErr) {
        console.error('Erro ao buscar preference:', mpErr);
      }
    }
    
    return res.json({
      status: corrida.status
    });
    
  } catch (err) {
    console.error('Erro ao verificar pagamento:', err);
    res.status(500).json({ erro: 'Erro ao verificar pagamento' });
  }
});

// Adicione esta rota no seu server.js (backend)
app.get('/status-corrida/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            "SELECT status FROM corridas WHERE id = $1",
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.json({ success: false, status: 'not_found' });
        }
        
        res.json({ 
            success: true, 
            status: result.rows[0].status 
        });
    } catch (err) {
        console.error('Erro em /status-corrida:', err);
        res.status(500).json({ success: false });
    }
});

// CONFIRMAR PAGAMENTO MANUALMENTE (quando voltar do Mercado Pago)


// ===============================================
// MONITOR (fica antes do listen)
// ===============================================
setInterval(monitorarExpiracoes, 5000);



// ⚠️ ROTA DE TESTE - SÓ PARA DESENVOLVIMENTO
// Marca uma corrida como PAGO_ONLINE sem passar pelo Mercado Pago
// ⚠️ ROTA DE TESTE – SIMULA PAGAMENTO ONLINE (LIBERA A CORRIDA)
app.post('/debug/liberar-corrida', async (req, res) => {
  try {
    const { corridaId } = req.body;

    if (!corridaId) {
      return res.status(400).json({ erro: 'corridaId é obrigatório' });
    }

    await pool.query(
      `
      UPDATE corridas
      SET status = 'liberada',
          forma_pagamento = 'ONLINE'
      WHERE id = $1
        AND status = 'aguardando_pagamento'
      `,
      [corridaId]
    );

    return res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro em /debug/liberar-corrida:', err);
    res.status(500).json({ erro: 'Erro ao liberar corrida (debug)' });
  }
});


// ===============================================
// ROTA 404 (sempre última)
// ===============================================
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Rota não encontrada',
    available_routes: [
      '/',
      '/health',
      '/app',
      '/install',
      '/cadastro',
      '/login',
      '/pedir-corrida',
      '/pagar-corrida',
      '/mp-retorno',
      '/verificar-pagamento/:corridaId',
      '/admin/dashboard'
    ]
  });
});

// ===============================================
// INICIAR SERVIDOR
// ===============================================

// Testar conexão com banco antes de iniciar
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Erro ao conectar ao banco:', err.message);
  } else {
    console.log('✅ Conectado ao banco de dados PostgreSQL');
    release();
  }
});

app.listen(port, () => {
  console.log('='.repeat(50));
  console.log(`🚀 Servidor Falcões rodando na porta ${port}`);
  console.log(`🔗 Backend URL: ${PUBLIC_BASE_URL}`);
  console.log(`🌐 Frontend URL: ${FRONT_URL}`);
  console.log(`💰 Mercado Pago: ${process.env.MP_ACCESS_TOKEN ? 'Configurado' : 'Modo TESTE'}`);
  console.log('='.repeat(50));
});

// Rota para o motoboy avisar que coletou o pedido e saiu para entrega
app.post('/iniciar-corrida', async (req, res) => {
    const { corrida_id, motoboy_id } = req.body;

    if (!corrida_id || !motoboy_id) {
        return res.status(400).json({ success: false, message: 'Dados incompletos' });
    }

    try {
        // Atualiza o status para 'em_andamento'
        const result = await pool.query(
            "UPDATE corridas SET status = 'em_andamento' WHERE id = $1 AND motoboy_id = $2 AND status = 'liberada' RETURNING id",
            [corrida_id, motoboy_id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Corrida não encontrada ou já iniciada' });
        }

        console.log(`▶️ Corrida ${corrida_id} marcada como EM ANDAMENTO pelo motoboy ${motoboy_id}`);
        res.json({ success: true, message: 'Entrega iniciada!' });
    } catch (err) {
        console.error('Erro ao iniciar corrida:', err);
        res.status(500).json({ success: false, message: 'Erro no servidor' });
    }
});