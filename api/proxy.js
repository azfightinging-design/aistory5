// Vercel Serverless Function: 通用 Ark 代理（标准路径 /api/proxy.js）
export default async function handler(req, res) {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,HEAD');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const ARK_API_KEY = process.env.ARK_API_KEY || '9bd00217-f46c-487a-b2b3-e98b424b18b1';
    // 使用不带 /api/v3 的基础域名，前端通过 ?path= 自由指定完整路径
    const ARK_BASE = process.env.ARK_BASE_ORIGIN || 'https://ark.cn-beijing.volces.com';

    const path = (req.query?.path || '').toString() || '/api/v3/images/generations';
    const targetUrl = `${ARK_BASE}${path.startsWith('/') ? path : '/' + path}`;

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
        res.status(500).json({ error: err?.message || 'proxy error' });
    }
}


