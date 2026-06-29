// ============================================================
//  INTEGRADOR OPENNAVENT  —  Feed XML automático (Node.js)
//  Hospede no Vercel
// ============================================================

const fetch = require('node-fetch');

const SUPABASE_URL = 'https://koeybtgqlhbdljqtktnw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvZXlidGdxbGhiZGxqcXRrdG53Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgwNzIyODEsImV4cCI6MjA3MzY0ODI4MX0.UaiaGMSK4l_nHQjMYD6tNO3kERDVppurImDwAwDQeMQ';
const SITE_URL = 'https://corretora-goncalves.netlify.app';

// ---------------------------------------------------------------
// Mapeamento de tipo de imóvel → idTipo / idSubTipo (OpenNavent)
// Ajuste os IDs conforme a tabela oficial do portal
// ---------------------------------------------------------------
const TIPO_MAP = {
    'Apartamento':        { idTipo: '2',  idSubTipo: '34' },
    'Casa':               { idTipo: '1',  idSubTipo: '1'  },
    'Cobertura':          { idTipo: '2',  idSubTipo: '35' },
    'Terreno':            { idTipo: '3',  idSubTipo: '10' },
    'Comercial':          { idTipo: '4',  idSubTipo: '20' },
    'Kitnet':             { idTipo: '2',  idSubTipo: '36' },
};

function getTipoIds(tipoStr) {
    const key = Object.keys(TIPO_MAP).find(k =>
        tipoStr && tipoStr.toLowerCase().includes(k.toLowerCase())
    );
    return key ? TIPO_MAP[key] : { idTipo: '2', idSubTipo: '34' }; // padrão: Apartamento
}

// ---------------------------------------------------------------
// Mapeamento de características OpenNavent
// id CFT3 = área construída (m²)  |  outros = comodidades booleanas
// ---------------------------------------------------------------
// Campos PRINCIPALES: quantidade vai em <valor>, sem <idValor>
const CARAC_MAP = {
    quartos:   { id: 'CFT2', nome: 'PRINCIPALES|QUARTO'  },
    banheiros: { id: 'CFT3', nome: 'PRINCIPALES|BANHEIRO' },
    suites:    { id: 'CFT4', nome: 'PRINCIPALES|SUITE'   },
    garagem:   { id: 'CFT7', nome: 'PRINCIPALES|VAGA'    },
};

// ---------------------------------------------------------------
// Busca apenas imóveis ativos no Supabase
// ---------------------------------------------------------------
async function buscarImoveis() {
    const url = `${SUPABASE_URL}/rest/v1/imoveis?select=*&status=eq.ativo`;

    const response = await fetch(url, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

// Envolve valor em CDATA
function cdata(val) {
    if (val === null || val === undefined) return '<![CDATA[]]>';
    return `<![CDATA[ ${String(val).trim()} ]]>`;
}

// Gera tag simples com CDATA
function tag(nome, valor, indent = '        ') {
    return `${indent}<${nome}>\n${indent}    ${cdata(valor)}\n${indent}</${nome}>\n`;
}

// Remove tudo que não é número
function soNumeros(str) {
    if (!str) return '';
    return String(str).replace(/\D/g, '');
}

// Timestamp Unix (segundos) da data de criação
function toUnixTimestamp(dataStr) {
    if (!dataStr) return Math.floor(Date.now() / 1000);
    const ts = Date.parse(dataStr);
    return isNaN(ts) ? Math.floor(Date.now() / 1000) : Math.floor(ts / 1000);
}

// Extrai fotos do campo imagens
function extrairFotos(row) {
    const raw = row.imagens;
    if (!raw) return [];
    let lista;
    try {
        lista = Array.isArray(raw) ? raw : JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(lista)) return [];

    return lista
        .map(item => (typeof item === 'object' && item.url ? item.url : (typeof item === 'string' ? item : null)))
        .filter(url => url && url.startsWith('http'));
}

// Extrai lista de strings de um campo JSON ou CSV
function extrairLista(row, campo) {
    const raw = row[campo];
    if (!raw) return [];
    let lista;
    try {
        lista = Array.isArray(raw) ? raw : JSON.parse(raw);
    } catch {
        return String(raw).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (!Array.isArray(lista)) return [];
    return lista.filter(Boolean).map(String);
}

// ---------------------------------------------------------------
// Handler principal (Vercel)
// ---------------------------------------------------------------
module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/xml; charset=UTF-8');
    res.setHeader('Cache-Control', 'no-cache');

    const imoveis = await buscarImoveis();

    // Timestamp geral do feed (mais recente entre os imóveis, ou agora)
    const timestamps = imoveis.map(r => toUnixTimestamp(r.updated_at || r.created_at));
    const dataModificacao = timestamps.length > 0 ? Math.max(...timestamps) : Math.floor(Date.now() / 1000);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<OpenNavent>\n';
    xml += `    <dataModificacao>\n        ${cdata(dataModificacao)}\n    </dataModificacao>\n`;
    xml += '    <Imoveis>\n';

    for (const row of imoveis) {
        const id          = String(row.id || '');
        const titulo      = row.name || '';
        const descricao   = row.info_adicional || '';
        const tipoStr     = row.tipoimovel || 'Apartamento';
        const { idTipo, idSubTipo } = getTipoIds(tipoStr);

        const precoVenda  = parseFloat(row.precovenda) || 0;

        const area        = row.areaimovel || '';
        const quartos     = row.quartos    || '';
        const banheiros   = row.banheiros  || '';
        const suites      = row.suitesqtd  || '';
        const garagem     = row.garagemvagas || '';

        const rua         = row.rua    || '';
        const bairro      = row.bairro || '';
        const cidade      = row.cidade || '';
        const cep         = soNumeros(row.cep);
        const latitude    = row.latitude  || '';
        const longitude   = row.longitude || '';

        const fotos       = extrairFotos(row);
        const videoCode   = row.video_codigo || '';
        const tour360     = row.tour360_url  || '';

        // Endereço completo
        const enderecoCompleto = [rua, bairro, cidade].filter(Boolean).join(', ');

        // Link do imóvel no site
        const linkImovel  = `${SITE_URL}/property.html?id=${encodeURIComponent(id)}`;

        xml += '        <Imovel>\n';

        // --- Identificação ---
        xml += tag('codigoAnuncio',    id,      '            ');
        xml += tag('codigoReferencia', id,      '            ');
        xml += tag('titulo',           titulo,  '            ');
        xml += tag('descricao',        descricao, '            ');

        // --- Tipo de propriedade ---
        xml += '            <tipoPropriedade>\n';
        xml += tag('idTipo',    idTipo,    '                ');
        xml += tag('idSubTipo', idSubTipo, '                ');
        xml += '            </tipoPropriedade>\n';

        // --- Características ---
        xml += '            <caracteristicas>\n';

        // Metragem: CFT101 = AREA_UTIL | CFT100 = AREA_TOTAL | CON1 = unidade M2
        if (area) {
            xml += '                <caracteristica>\n';
            xml += tag('id',    'CFT101', '                    ');
            xml += tag('nome',  'MEDIDAS|AREA_UTIL', '                    ');
            xml += tag('valor', area, '                    ');
            xml += '                </caracteristica>\n';

            xml += '                <caracteristica>\n';
            xml += tag('id',    'CFT100', '                    ');
            xml += tag('nome',  'MEDIDAS|AREA_TOTAL', '                    ');
            xml += tag('valor', area, '                    ');
            xml += '                </caracteristica>\n';

            xml += '                <caracteristica>\n';
            xml += tag('id',      'CON1', '                    ');
            xml += tag('nome',    'MEDIDAS|UNIDAD_DE_MEDIDA', '                    ');
            xml += tag('idValor', 'M2', '                    ');
            xml += '                </caracteristica>\n';
        }

        // Campos PRINCIPALES: apenas <valor> com a quantidade (sem <idValor>)
        const caracItems = [
            { campo: quartos,   carac: CARAC_MAP.quartos   },
            { campo: banheiros, carac: CARAC_MAP.banheiros  },
            { campo: suites,    carac: CARAC_MAP.suites     },
            { campo: garagem,   carac: CARAC_MAP.garagem    },
        ];

        for (const { campo, carac } of caracItems) {
            if (campo) {
                xml += '                <caracteristica>\n';
                xml += tag('id',    carac.id,   '                    ');
                xml += tag('nome',  carac.nome, '                    ');
                xml += tag('valor', campo,      '                    ');
                xml += '                </caracteristica>\n';
            }
        }

        xml += '            </caracteristicas>\n';

        // --- Preços ---
        xml += '            <precos>\n';
        if (precoVenda > 0) {
            xml += '                <preco>\n';
            xml += tag('operacao',   'VENDA',                         '                    ');
            xml += tag('quantidade', soNumeros(String(precoVenda)),   '                    ');
            xml += tag('moeda',      'BRL',                           '                    ');
            xml += '                </preco>\n';
        }
        xml += '            </precos>\n';

        // --- Multimídia ---
        xml += '            <multimidia>\n';

        // Imagens
        if (fotos.length > 0) {
            xml += '                <imagens>\n';
            for (let i = 0; i < fotos.length; i++) {
                xml += '                    <imagem>\n';
                xml += tag('titulo',    `Foto ${i + 1}`, '                        ');
                xml += tag('urlImagem', fotos[i],        '                        ');
                xml += '                    </imagem>\n';
            }
            xml += '                </imagens>\n';
        }

        // Tour 360
        if (tour360) {
            xml += '                <tours360>\n';
            xml += '                    <tour360>\n';
            xml += tag('codigoTour360', tour360,         '                        ');
            xml += tag('titulo',        'Tour Virtual',  '                        ');
            xml += '                    </tour360>\n';
            xml += '                </tours360>\n';
        }

        // Vídeo (código YouTube ou URL)
        if (videoCode) {
            xml += '                <videos>\n';
            xml += '                    <video>\n';
            xml += tag('codigoVideo', videoCode,   '                        ');
            xml += tag('titulo',      'Vídeo',     '                        ');
            xml += '                    </video>\n';
            xml += '                </videos>\n';
        }

        xml += '            </multimidia>\n';

        // --- Localização ---
        // Localidade por extenso: "Bairro, Cidade, Estado, Brasil"
        const localidadeTexto = [bairro, cidade, 'Rio de Janeiro', 'Brasil'].filter(Boolean).join(', ');

        xml += '            <localizacao>\n';
        xml += tag('localidade',   localidadeTexto,  '                ');
        xml += tag('endereco',     enderecoCompleto, '                ');
        xml += tag('latitude',     latitude,         '                ');
        xml += tag('longitude',    longitude,        '                ');
        xml += tag('mostrarMapa',  latitude && longitude ? 'EXACTO' : 'APROXIMADO', '                ');
        xml += tag('codigoPostal', cep,              '                ');
        xml += '            </localizacao>\n';

        // --- Publicação ---
        xml += '            <publicacao>\n';
        xml += tag('tipoPublicacao', 'HOME', '                ');
        xml += '            </publicacao>\n';

        // --- Link externo (campo extra útil para portais que aceitam) ---
        xml += tag('linkExterno', linkImovel, '            ');

        // --- Publicador ---
        xml += '            <publicador>\n';
        xml += tag('codigoImobiliaria', '', '                '); // substituir pelo código fornecido pelo portal
        xml += tag('emailUsuario',      'corretora.goncalves25@gmail.com', '                ');
        xml += tag('emailContato',      'corretora.goncalves25@gmail.com', '                ');
        xml += tag('nomeContato',       'Corretora Gonçalves',             '                ');
        xml += tag('telefoneContato',   '21 97125-2642',                   '                ');
        xml += '            </publicador>\n';

        xml += '        </Imovel>\n';
    }

    xml += '    </Imoveis>\n';
    xml += '</OpenNavent>';

    res.status(200).send(xml);
};
