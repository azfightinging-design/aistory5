// Vercel Serverless Function: 支持 Ark 和普通 TTS 的代理
export default async function handler(req, res) {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,HEAD');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const path = (req.query?.path || '').toString();

    // 处理普通 TTS 请求
    if (path === '/tts') {
        return handleTtsRequest(req, res);
    }

    // 处理 Ark API 请求
    return handleArkRequest(req, res, path);
}

async function handleTtsRequest(req, res) {
    const TTS_ACCESS_TOKEN = process.env.TTS_ACCESS_TOKEN || 'X4K7Vil8T7tUqzbWb4ZlVC-717cPsqbu';
    const TTS_APPID = process.env.TTS_APPID || '8898489484';

    try {
        const { text, voice = '0', format = 'mp3' } = req.body || {};
        if (!text) {
            return res.status(400).json({ error: 'text 参数不能为空' });
        }

        const ttsUrl = 'https://cloud-vms.volcengineapi.com/?Action=TextToSpeech&Version=2020-08-01';
        const upstream = await fetch(ttsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${TTS_ACCESS_TOKEN}`
            },
            body: JSON.stringify({
                AppId: TTS_APPID,
                Text: text,
                VoiceType: voice,
                Format: format,
                SampleRate: '16000'
            })
        });

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            return res.status(502).json({ error: `TTS 接口错误：${upstream.status} ${errText}` });
        }

        const result = await upstream.json();
        if (result.Audio) {
            // 返回 base64 编码的音频数据
            const audioBuffer = Buffer.from(result.Audio, 'base64');
            res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
            res.setHeader('Content-Length', audioBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.status(200).send(audioBuffer);
        } else {
            return res.status(500).json({ error: 'TTS 响应中未找到音频数据' });
        }
    } catch (err) {
        return res.status(500).json({ error: err?.message || 'TTS 代理错误' });
    }
}

async function handleArkRequest(req, res, path) {
    const ARK_API_KEY = process.env.ARK_API_KEY || '9bd00217-f46c-487a-b2b3-e98b424b18b1';
    const ARK_BASE = process.env.ARK_BASE_ORIGIN || 'https://ark.cn-beijing.volces.com';

    const arkPath = path || '/api/v3/images/generations';
    const targetUrl = `${ARK_BASE}${arkPath.startsWith('/') ? arkPath : '/' + arkPath}`;

    try {
        const isBodyless = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ARK_API_KEY}`
            },
            body: isBodyless ? undefined : JSON.stringify(req.body || {})
        });

        const contentType = upstream.headers.get('content-type') || '';
        const status = upstream.status;
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!contentType.includes('application/json')) {
            const arrayBuf = await upstream.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            res.status(status).send(buffer);
            return;
        }

        const data = await upstream.json().catch(async () => {
            const text = await upstream.text().catch(() => '');
            return { raw: text };
        });
        res.status(status).json(data);
    } catch (err) {
        res.status(500).json({ error: err?.message || 'Ark 代理错误' });
    }
}


