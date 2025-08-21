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
    // 使用火山引擎语音合成大模型的专用凭据
    const TTS_ACCESS_TOKEN = process.env.TTS_ACCESS_TOKEN || 'X4K7Vil8T7tUqzbWb4ZlVC-717cPsqbu';
    const TTS_APPID = process.env.TTS_APPID || '8898489484';
    const TTS_CLUSTER = process.env.TTS_CLUSTER || 'volcano_tts';

    try {
        const { text, voice = 'ICL_zh_female_nuanxinxuejie_tob', format = 'wav' } = req.body || {};
        if (!text) {
            return res.status(400).json({ error: 'text 参数不能为空' });
        }

        console.log(`[BigTTS] 请求文本: ${text}, 音色: ${voice}, 格式: ${format}`);
        console.log(`[BigTTS] 使用 APPID: ${TTS_APPID}, ACCESS_TOKEN: ${TTS_ACCESS_TOKEN.substring(0, 10)}...`);

        // 使用火山引擎语音合成大模型的正确端点
        const ttsUrl = 'https://openspeech.bytedance.com/api/v1/tts';
        
        // 生成唯一请求ID
        const reqid = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const uid = `user_${Date.now()}`;
        
        const requestBody = {
            app: {
                appid: TTS_APPID,
                token: TTS_ACCESS_TOKEN,
                cluster: TTS_CLUSTER
            },
            user: {
                uid: uid
            },
            audio: {
                voice_type: voice,
                encoding: format === 'mp3' ? 'mp3' : 'wav',
                speed_ratio: 1.0,
                volume_ratio: 1.0,
                pitch_ratio: 1.0
            },
            request: {
                reqid: reqid,
                text: text,
                text_type: 'plain',
                operation: 'query',
                with_frontend: 1,
                frontend_type: 'unitTson'
            }
        };
        
        console.log(`[BigTTS] 请求体:`, JSON.stringify(requestBody, null, 2));
        
        // 使用火山引擎的标准认证格式
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer;${TTS_ACCESS_TOKEN}`,
            'User-Agent': 'Mozilla/5.0 (compatible; Vercel-Proxy/1.0)'
        };
        
        console.log(`[BigTTS] 请求头:`, { ...headers, Authorization: 'Bearer [HIDDEN]' });
        
        let upstream;
        try {
            console.log(`[BigTTS] 开始请求: ${ttsUrl}`);
            upstream = await fetch(ttsUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                timeout: 30000 // 大模型可能需要更长时间
            });
            console.log(`[BigTTS] 请求完成，状态: ${upstream.status}`);
        } catch (fetchError) {
            console.error(`[BigTTS] 网络请求失败:`, fetchError);
            throw new Error(`网络请求失败: ${fetchError.message}`);
        }

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

        // 火山引擎语音合成大模型返回 JSON 格式
        const result = await upstream.json();
        console.log(`[BigTTS] 完整响应:`, JSON.stringify(result, null, 2));

        // 检查响应中的音频数据
        if (result.data) {
            // 火山引擎返回 base64 编码的音频数据
            console.log(`[BigTTS] 找到音频数据，长度: ${result.data.length}`);
            const audioBuffer = Buffer.from(result.data, 'base64');
            
            // 根据格式设置正确的 Content-Type
            const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', audioBuffer.length);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            return res.status(200).send(audioBuffer);
        } else {
            console.log(`[BigTTS] 响应中未找到音频数据`);
            return res.status(500).json({ 
                error: '火山引擎 TTS 响应中未找到音频数据', 
                response: result,
                expectedField: 'data'
            });
        }
    } catch (err) {
        console.error(`[BigTTS] 异常:`, err);
        console.error(`[BigTTS] 错误类型: ${err?.name}`);
        console.error(`[BigTTS] 错误消息: ${err?.message}`);
        console.error(`[BigTTS] 错误代码: ${err?.code}`);
        
        // 根据错误类型返回不同的状态码
        let statusCode = 500;
        let errorMessage = err?.message || 'BigTTS 代理错误';
        
        if (err?.message?.includes('网络请求失败')) {
            statusCode = 502;
            errorMessage = `上游服务不可达: ${err.message}`;
        } else if (err?.code === 'ENOTFOUND') {
            statusCode = 502;
            errorMessage = 'DNS 解析失败，无法连接到 BigTTS 服务';
        } else if (err?.code === 'ECONNREFUSED') {
            statusCode = 502;
            errorMessage = 'BigTTS 服务拒绝连接';
        } else if (err?.code === 'ETIMEDOUT') {
            statusCode = 504;
            errorMessage = 'BigTTS 服务响应超时';
        }
        
        return res.status(statusCode).json({ 
            error: errorMessage,
            code: err?.code || 'UNKNOWN_ERROR',
            type: err?.name || 'UnknownError',
            timestamp: new Date().toISOString(),
            requestBody: requestBody
        });
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


