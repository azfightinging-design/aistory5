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
    const TTS_SECRET_KEY = process.env.TTS_SECRET_KEY || 'rdkng4T83mg2E_Fii1viTkYgCtvI2Avu';
    const TTS_APPID = process.env.TTS_APPID || '8898489484';
    const TTS_INSTANCE_NAME = process.env.TTS_INSTANCE_NAME || 'Speech_Synthesis2000000336765113602';

    try {
        const { text, voice = '0', format = 'mp3' } = req.body || {};
        if (!text) {
            return res.status(400).json({ error: 'text 参数不能为空' });
        }

        console.log(`[TTS] 请求文本: ${text}, 音色: ${voice}, 格式: ${format}`);

        const ttsUrl = 'https://cloud-vms.volcengineapi.com/?Action=TextToSpeech&Version=2020-08-01';
        const upstream = await fetch(ttsUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer;${TTS_ACCESS_TOKEN}`, // 正确的 Bearer 格式
                'X-Secret-Key': TTS_SECRET_KEY,
                'X-Instance-Name': TTS_INSTANCE_NAME // 添加实例名称
            },
            body: JSON.stringify({
                AppId: TTS_APPID,
                Text: text,
                VoiceType: voice,
                Format: format,
                SampleRate: '16000'
            })
        });

        console.log(`[TTS] 响应状态: ${upstream.status}`);

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.log(`[TTS] 错误响应: ${errText}`);
            return res.status(502).json({ error: `TTS 接口错误：${upstream.status} ${errText}` });
        }

        const result = await upstream.json();
        console.log(`[TTS] 响应结构:`, Object.keys(result || {}));

        if (result.Audio) {
            // 返回 base64 编码的音频数据
            const audioBuffer = Buffer.from(result.Audio, 'base64');
            res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
            res.setHeader('Content-Length', audioBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.status(200).send(audioBuffer);
        } else {
            console.log(`[TTS] 未找到音频数据，完整响应:`, result);
            return res.status(500).json({ error: 'TTS 响应中未找到音频数据', response: result });
        }
    } catch (err) {
        console.error(`[TTS] 异常:`, err);
        return res.status(500).json({ error: err?.message || 'TTS 代理错误', stack: err?.stack });
    }
}

async function handleArkRequest(req, res, path) {
    const ARK_API_KEY = process.env.ARK_API_KEY || '9bd00217-f46c-487a-b2b3-e98b424b18b1';
    const ARK_BASE = process.env.ARK_BASE_ORIGIN || 'https://ark.cn-beijing.volces.com';

    const arkPath = path || '/api/v3/images/generations';
    const targetUrl = `${ARK_BASE}${arkPath.startsWith('/') ? arkPath : '/' + arkPath}`;

    try {
        const isBodyless = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
        
        console.log(`[Ark代理] 请求: ${req.method} ${targetUrl}`);
        console.log(`[Ark代理] 请求体:`, req.body);
        
        const upstream = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ARK_API_KEY}`
            },
            body: isBodyless ? undefined : JSON.stringify(req.body || {})
        });

        console.log(`[Ark代理] 响应状态: ${upstream.status}`);
        
        const contentType = upstream.headers.get('content-type') || '';
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.log(`[Ark代理] 错误响应: ${errText}`);
            return res.status(upstream.status).json({ 
                error: `上游API错误: ${upstream.status}`,
                details: errText 
            });
        }

        if (!contentType.includes('application/json')) {
            const arrayBuf = await upstream.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            res.status(upstream.status).send(buffer);
            return;
        }

        const data = await upstream.json().catch(async () => {
            const text = await upstream.text().catch(() => '');
            return { raw: text };
        });
        res.status(upstream.status).json(data);
    } catch (err) {
        console.error(`[Ark代理] 异常:`, err);
        res.status(500).json({ error: err?.message || 'Ark 代理错误', stack: err?.stack });
    }
}


