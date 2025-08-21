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
    const TTS_INSTANCE_NAME = process.env.TTS_INSTANCE_NAME || 'BigTTS2000000336250481058';

    try {
        const { text, voice = 'zh_female_sft', format = 'mp3' } = req.body || {};
        if (!text) {
            return res.status(400).json({ error: 'text 参数不能为空' });
        }

        console.log(`[BigTTS] 请求文本: ${text}, 音色: ${voice}, 格式: ${format}`);
        console.log(`[BigTTS] 使用实例: ${TTS_INSTANCE_NAME}`);

        // 使用语音合成大模型接口
        const ttsUrl = 'https://ark.cn-beijing.volces.com/api/v3/audio/speech';
        
        const requestBody = {
            model: TTS_INSTANCE_NAME, // 使用实例名称作为模型
            input: text,
            voice: voice, // 大模型支持的音色
            response_format: format,
            speed: 1.0 // 语速
        };
        
        console.log(`[BigTTS] 请求体:`, requestBody);
        
        // 使用与文本生成相同的认证方式
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TTS_ACCESS_TOKEN}`,
            'User-Agent': 'Mozilla/5.0 (compatible; Vercel-Proxy/1.0)',
            'Accept': 'audio/mpeg, application/json'
        };
        
        console.log(`[BigTTS] 请求头:`, { ...headers, Authorization: 'Bearer [HIDDEN]' });
        
        const upstream = await fetch(ttsUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(requestBody),
            timeout: 30000 // 大模型可能需要更长时间
        });

        console.log(`[BigTTS] 响应状态: ${upstream.status}`);

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.log(`[BigTTS] 错误响应 ${upstream.status}: ${errText}`);
            
            // 尝试解析错误信息
            let errorInfo = errText;
            try {
                const errorJson = JSON.parse(errText);
                errorInfo = errorJson;
            } catch {}
            
            return res.status(502).json({ 
                error: `BigTTS 接口错误：${upstream.status}`, 
                details: errorInfo,
                url: ttsUrl,
                requestBody: requestBody
            });
        }

        // 大模型接口可能直接返回音频二进制流
        const contentType = upstream.headers.get('content-type') || '';
        console.log(`[BigTTS] 响应内容类型: ${contentType}`);

        if (contentType.includes('audio/')) {
            // 直接返回音频流
            const arrayBuf = await upstream.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', buffer.length);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.status(200).send(buffer);
        } else {
            // 如果返回 JSON，尝试解析
            const result = await upstream.json();
            console.log(`[BigTTS] JSON 响应:`, result);
            
            // 检查是否有音频URL或数据
            const audioUrl = result.url || result.audio_url;
            if (audioUrl) {
                // 如果返回URL，重定向或代理获取
                console.log(`[BigTTS] 音频URL: ${audioUrl}`);
                return res.redirect(audioUrl);
            }
            
            return res.status(500).json({ 
                error: 'BigTTS 返回了意外的响应格式', 
                response: result,
                contentType: contentType
            });
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
        
        // 添加更多头部以确保兼容性
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ARK_API_KEY}`,
            'User-Agent': 'Mozilla/5.0 (compatible; Vercel-Proxy/1.0)',
            'Accept': 'application/json',
            'Cache-Control': 'no-cache'
        };

        console.log(`[Ark代理] 请求头:`, headers);

        const fetchOptions = {
            method: req.method,
            headers,
            body: isBodyless ? undefined : JSON.stringify(req.body || {}),
            timeout: 30000 // 30秒超时
        };

        const upstream = await fetch(targetUrl, fetchOptions);

        console.log(`[Ark代理] 响应状态: ${upstream.status}`);
        console.log(`[Ark代理] 响应头:`, Object.fromEntries(upstream.headers.entries()));
        
        const contentType = upstream.headers.get('content-type') || '';
        if (contentType) res.setHeader('Content-Type', contentType);

        if (!upstream.ok) {
            const errText = await upstream.text().catch(() => '');
            console.log(`[Ark代理] 错误响应: ${errText}`);
            return res.status(upstream.status).json({ 
                error: `上游API错误: ${upstream.status}`,
                details: errText,
                url: targetUrl 
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
        
        console.log(`[Ark代理] 成功响应数据键:`, Object.keys(data || {}));
        res.status(upstream.status).json(data);
    } catch (err) {
        console.error(`[Ark代理] 异常:`, err);
        console.error(`[Ark代理] 错误详情: ${err?.message}`);
        console.error(`[Ark代理] 错误堆栈: ${err?.stack}`);
        
        // 提供更详细的错误信息
        const errorResponse = {
            error: err?.message || 'Ark 代理错误',
            code: err?.code || 'UNKNOWN_ERROR',
            cause: err?.cause?.message || 'Unknown cause',
            url: targetUrl,
            timestamp: new Date().toISOString()
        };
        
        res.status(500).json(errorResponse);
    }
}


