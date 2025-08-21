// 简易静态服务器 + TTS 服务端代理（无第三方依赖）
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 配置
const PORT = process.env.PORT || 3000;
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
// 使用与前端相同的 API Key（也支持从环境变量读取，优先使用环境变量）
const ARK_API_KEY = process.env.ARK_API_KEY || '9bd00217-f46c-487a-b2b3-e98b424b18b1';
// 语音模型、默认音色/格式（可按需调整）
const TTS_MODEL = process.env.TTS_MODEL || 'doubao-tts-1';
const DEFAULT_VOICE = process.env.TTS_VOICE || 'zh_female';
const DEFAULT_FORMAT = process.env.TTS_FORMAT || 'mp3';

function serveStatic(req, res) {
    let pathname = url.parse(req.url).pathname;
    if (pathname === '/') pathname = '/index.html';
    const filePath = path.join(__dirname, pathname);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        }[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.end(data);
    });
}

async function handleTts(req, res) {
    try {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        await new Promise(resolve => req.on('end', resolve));
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
        const text = (parsed.text || '').trim();
        const voice = (parsed.voice || DEFAULT_VOICE).trim();
        const format = (parsed.format || DEFAULT_FORMAT).trim();
        if (!text) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: 'text 不能为空' }));
            return;
        }

        // 使用 Ark HTTP 接口合成语音。若需 WebSocket 流式，请参考官方文档：
        // https://www.volcengine.com/docs/6561/1257584?lang=zh#websocket
        const endpoint = `${ARK_BASE_URL}/audio/speech`;
        const upstream = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ARK_API_KEY}`
            },
            body: JSON.stringify({ model: TTS_MODEL, input: text, voice, format })
        });

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            res.statusCode = 502;
            res.end(`Ark TTS 上游错误: ${upstream.status} ${errText}`);
            return;
        }

        const arrayBuf = await upstream.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const contentType = format === 'wav' ? 'audio/wav' : format === 'pcm' ? 'audio/L16' : 'audio/mpeg';
        res.statusCode = 200;
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.end(buffer);
    } catch (err) {
        console.error('TTS 代理错误:', err);
        res.statusCode = 500;
        res.end('TTS 代理内部错误');
    }
}

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url);
    if (req.method === 'POST' && parsed.pathname === '/api/tts') {
        return handleTts(req, res);
    }
    serveStatic(req, res);
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});


