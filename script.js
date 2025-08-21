// 全局变量
let isAdvancedModeOpen = false;

// API 常量
// 使用 Vercel 代理，避免前端跨域与密钥暴露
const PROXY_BASE = (typeof window !== 'undefined' ? window.__ARK_PROXY_BASE__ : '') || '';
// 如果你部署在 Vercel，设置 window.__ARK_PROXY_BASE__ = 'https://你的vercel域名';
const TEXT_MODEL = 'doubao-seed-1-6-250615';
const IMAGE_MODEL = 'doubao-seedream-3-0-t2i-250415';

// LLM system prompt（来自 LLM system prompt.txt）
const LLM_SYSTEM_PROMPT = [
    '你是一名 专业儿童绘本创作者兼插画指导。',
    '你的任务是根据用户提供的故事创意，生成完整的 绘本分镜脚本（包括每页文案和插画提示），供后续文生图模型生成插画。',
    '',
    '要求：',
    '1. 输出 每页的分镜信息，包括：',
    '   - 页码（page）',
    '   - 文案文本（text，旁白或对白，简短生动，适合儿童）',
    '   - 插画提示（illustration_prompt，详细描述画面、角色、动作、场景、光影氛围，便于 AI 绘图）',
    '2. 绘本需有 开端 → 发展 → 高潮 → 结局，故事积极向上，富有想象力。',
    '3. 保持角色在不同页面的外观和设定一致。',
    '4. 输出格式必须为 JSON，示例：',
    '{\n  "title": "绘本标题",\n  "theme": "故事主题",\n  "pages": [\n    {\n      "page": 1,\n      "illustration_prompt": "详细画面描述",\n      "text": "文案文本"\n    }\n  ],\n  "ending": "故事总结或寓意"\n}'
].join('\n');

// 工具函数
function extractTextFromMessageContent(content) {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
    }
    return '';
}

function extractJsonFromText(text) {
    if (!text) return null;
    let candidate = text;
    // 优先提取 ```json ... ``` 或 ``` ... ``` 代码块内容
    const fenceMatch = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/);
    if (fenceMatch && fenceMatch[1]) {
        candidate = fenceMatch[1];
    } else {
        // 回退：截取首个 { 到 最后一个 }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            candidate = text.slice(start, end + 1);
        }
    }
    try {
        return JSON.parse(candidate);
    } catch (e) {
        return null;
    }
}

function updateLoadingMessage(message) {
    const el = document.querySelector('.loading-content p');
    if (el) el.textContent = message;
}

async function callTextLLM({ storyIdea, pageCount, advancedData }) {
    const advancedLines = [];
    if (advancedData?.protagonist) advancedLines.push(`主角：${advancedData.protagonist}`);
    if (advancedData?.scene) advancedLines.push(`场景：${advancedData.scene}`);
    if (advancedData?.theme) advancedLines.push(`主题：${advancedData.theme}`);
    if (advancedData?.ending) advancedLines.push(`结局：${advancedData.ending}`);

    const userInstruction = [
        `请根据以下信息生成${pageCount}页完整的儿童绘本脚本：`,
        `- 故事创意：${storyIdea}`,
        `- 页数：${pageCount}`,
        ...(advancedLines.length ? advancedLines.map(l => `- ${l}`) : []),
        '',
        '请严格按 system prompt 的 JSON 结构输出，字段包含：title, theme, pages[{page, illustration_prompt, text}], ending。',
        '每一页都需要有清晰一致的人物设定与场景信息；文字简短生动，适合儿童。',
        '只输出纯 JSON，不要任何额外说明、标题或代码块标记。'
    ].join('\n');

    const res = await fetch(`${PROXY_BASE}/api/ark-proxy?path=/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: TEXT_MODEL,
            messages: [
                { role: 'system', content: [{ type: 'text', text: LLM_SYSTEM_PROMPT }] },
                { role: 'user', content: [{ type: 'text', text: userInstruction }] }
            ]
        })
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`文案生成接口错误：${res.status} ${errText}`);
    }

    const data = await res.json();
    const contentText = extractTextFromMessageContent(data?.choices?.[0]?.message?.content);
    const json = extractJsonFromText(contentText);
    if (!json || !Array.isArray(json.pages)) {
        throw new Error('未能解析有效的绘本 JSON。');
    }
    return json;
}

async function generateImageByPrompt(prompt) {
    const res = await fetch(`${PROXY_BASE}/api/ark-proxy?path=/images/generations`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: IMAGE_MODEL,
            prompt,
            response_format: 'url',
            size: '1024x1024',
            guidance_scale: 3,
            watermark: true
        })
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`图片生成接口错误：${res.status} ${errText}`);
    }
    const data = await res.json();
    // 兼容不同返回格式
    const url = data?.data?.[0]?.url || data?.url || data?.data?.[0]?.b64_json || '';
    if (!url) throw new Error('图片生成接口未返回 URL。');
    return url;
}

function openBookViewer(pages) {
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="modal-content book-viewer">
            <div class="modal-header">
                <h3>我的AI绘本</h3>
                <button class="close-btn" onclick="this.closest('.modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body book-viewer-body">
                <div class="book-image-wrap">
                    <img id="book-image" class="book-image" src="" alt="page image" />
                </div>
                <div id="book-text" class="book-text"></div>
                <div class="book-audio">
                    <button id="tts-play" class="tts-btn"><i class="fas fa-volume-up"></i> 播放</button>
                </div>
                <div class="book-nav">
                    <button id="prev-page" class="example-btn nav-btn"><i class="fas fa-arrow-left"></i> 上一页</button>
                    <div id="page-indicator" class="page-indicator">1 / ${pages.length}</div>
                    <button id="next-page" class="generate-btn nav-btn">下一页 <i class="fas fa-arrow-right"></i></button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const imgEl = modal.querySelector('#book-image');
    const textEl = modal.querySelector('#book-text');
    const prevBtn = modal.querySelector('#prev-page');
    const nextBtn = modal.querySelector('#next-page');
    const indicator = modal.querySelector('#page-indicator');
    const ttsBtn = modal.querySelector('#tts-play');

    // 音频播放与缓存
    const audioEl = new Audio();
    const ttsCache = new Map(); // key: text, value: objectURL

    function setTtsButtonState(state) {
        // state: 'idle' | 'loading' | 'playing' | 'paused'
        if (!ttsBtn) return;
        if (state === 'loading') {
            ttsBtn.disabled = true;
            ttsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
            return;
        }
        ttsBtn.disabled = false;
        if (state === 'playing') {
            ttsBtn.innerHTML = '<i class="fas fa-pause"></i> 暂停';
        } else {
            ttsBtn.innerHTML = '<i class="fas fa-volume-up"></i> 播放';
        }
    }

    async function getOrCreateTtsUrl(text) {
        if (ttsCache.has(text)) return ttsCache.get(text);
        setTtsButtonState('loading');
        try {
            // 通过代理直达 Ark TTS
            const res = await fetch(`${PROXY_BASE}/api/ark-proxy?path=/audio/speech`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'doubao-tts-1',
                    input: text,
                    voice: 'zh_female',
                    format: 'mp3'
                })
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                throw new Error(`TTS 接口错误：${res.status} ${errText}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            ttsCache.set(text, url);
            return url;
        } catch (e) {
            showNotification(e?.message || 'TTS 生成失败，请稍后重试', 'error');
            throw e;
        } finally {
            setTtsButtonState('idle');
        }
    }

    let index = 0;
    function render() {
        const page = pages[index];
        imgEl.src = page.imageUrl || '';
        textEl.textContent = page.text || '';
        indicator.textContent = `${index + 1} / ${pages.length}`;
        prevBtn.disabled = index === 0;
        nextBtn.disabled = index === pages.length - 1;

        // 切换页面时，若正在播放则停止
        try { audioEl.pause(); } catch {}
        setTtsButtonState('idle');
    }

    prevBtn.addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
    nextBtn.addEventListener('click', () => { if (index < pages.length - 1) { index += 1; render(); } });

    ttsBtn.addEventListener('click', async () => {
        const page = pages[index];
        const text = (page?.text || '').trim();
        if (!text) {
            showNotification('该页没有可朗读的文本', 'error');
            return;
        }
        // 切换播放/暂停
        if (!audioEl.paused && !audioEl.ended) {
            audioEl.pause();
            setTtsButtonState('idle');
            return;
        }
        try {
            const url = await getOrCreateTtsUrl(text);
            audioEl.src = url;
            await audioEl.play();
            setTtsButtonState('playing');
        } catch (e) {
            // 错误已在 getOrCreateTtsUrl 处理
        }
    });

    audioEl.addEventListener('ended', () => setTtsButtonState('idle'));
    audioEl.addEventListener('pause', () => setTtsButtonState('idle'));

    // 外部点击关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) modal.remove();
    });

    render();
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

// 初始化应用
function initializeApp() {
    // 添加输入框焦点效果
    addInputFocusEffects();
    
    // 添加触摸反馈
    addTouchFeedback();
    
    // 设置示例数据
    setupExamples();
}



// 添加输入框焦点效果
function addInputFocusEffects() {
    const inputs = document.querySelectorAll('.input-field');
    inputs.forEach(input => {
        input.addEventListener('focus', function() {
            this.parentElement.style.transform = 'scale(1.02)';
        });
        
        input.addEventListener('blur', function() {
            this.parentElement.style.transform = 'scale(1)';
        });
    });
}

// 添加触摸反馈
function addTouchFeedback() {
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('touchstart', function() {
            this.style.transform = 'scale(0.95)';
        });
        
        button.addEventListener('touchend', function() {
            this.style.transform = 'scale(1)';
        });
    });
}

// 切换高级模式
function toggleAdvanced() {
    const advancedContent = document.getElementById('advanced-content');
    const advancedHeader = document.querySelector('.advanced-header');
    const playIcon = advancedHeader.querySelector('.fa-play');
    
    if (isAdvancedModeOpen) {
        // 关闭高级模式
        advancedContent.classList.remove('active');
        playIcon.style.transform = 'rotate(0deg)';
        isAdvancedModeOpen = false;
    } else {
        // 打开高级模式
        advancedContent.classList.add('active');
        playIcon.style.transform = 'rotate(90deg)';
        isAdvancedModeOpen = true;
    }
}

// 生成绘本
function generateBook() {
    // 获取输入值
    const simplePrompt = document.getElementById('simple-prompt').value.trim();
    const pageCount = document.getElementById('page-count').value;
    
    // 验证输入
    if (!simplePrompt) {
        showNotification('请输入简单提示词', 'error');
        return;
    }
    
    if (pageCount < 1 || pageCount > 50) {
        showNotification('页数必须在1-50之间', 'error');
        return;
    }
    
    // 获取高级模式的值
    const advancedData = {};
    if (isAdvancedModeOpen) {
        advancedData.protagonist = document.getElementById('protagonist').value.trim();
        advancedData.scene = document.getElementById('scene').value.trim();
        advancedData.theme = document.getElementById('theme').value.trim();
        advancedData.ending = document.getElementById('ending').value.trim();
    }
    
    // 显示加载状态
    showLoading();
    updateLoadingMessage('正在生成分镜脚本...');

    (async () => {
        try {
            const story = await callTextLLM({ storyIdea: simplePrompt, pageCount, advancedData });
            const pages = Array.isArray(story.pages) ? story.pages.slice(0, Number(pageCount)) : [];
            if (!pages.length) throw new Error('未返回任何页面内容。');

            updateLoadingMessage(`正在生成插画 0/${pages.length} ...`);

            const resultPages = [];
            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                const prompt = p.illustration_prompt || p.prompt || '';
                if (!prompt) throw new Error(`第${i + 1}页缺少 illustration_prompt。`);
                try {
                    const imageUrl = await generateImageByPrompt(prompt);
                    resultPages.push({
                        page: p.page || (i + 1),
                        text: p.text || '',
                        illustration_prompt: prompt,
                        imageUrl
                    });
                } catch (e) {
                    resultPages.push({
                        page: p.page || (i + 1),
                        text: p.text || '',
                        illustration_prompt: prompt,
                        imageUrl: ''
                    });
                }
                updateLoadingMessage(`正在生成插画 ${i + 1}/${pages.length} ...`);
            }

            hideLoading();
            showNotification('绘本生成成功！', 'success');
            openBookViewer(resultPages);
        } catch (error) {
            hideLoading();
            console.error(error);
            showNotification(error?.message || '生成失败，请稍后重试', 'error');
        }
    })();
}

// 显示示例
function showExamples() {
    const modal = document.getElementById('example-modal');
    modal.classList.add('active');
    
    // 添加点击外部关闭功能
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal();
        }
    });
}

// 关闭弹窗
function closeModal() {
    const modal = document.getElementById('example-modal');
    modal.classList.remove('active');
}

// 使用示例
function useExample(prompt, pages) {
    document.getElementById('simple-prompt').value = prompt;
    document.getElementById('page-count').value = pages;
    closeModal();
    
    // 添加使用示例的动画效果
    const simplePromptInput = document.getElementById('simple-prompt');
    simplePromptInput.style.animation = 'inputFocus 0.6s ease';
    setTimeout(() => {
        simplePromptInput.style.animation = '';
    }, 600);
    
    showNotification('已应用示例提示词', 'success');
}

// 显示加载状态
function showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.classList.add('active');
    
    // 禁用所有输入和按钮
    const inputs = document.querySelectorAll('input, button');
    inputs.forEach(input => {
        input.disabled = true;
    });
}

// 隐藏加载状态
function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    loadingOverlay.classList.remove('active');
    
    // 重新启用所有输入和按钮
    const inputs = document.querySelectorAll('input, button');
    inputs.forEach(input => {
        input.disabled = false;
    });
}

// 显示通知
function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    
    // 添加样式
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${type === 'success' ? 'rgba(78, 205, 196, 0.9)' : type === 'error' ? 'rgba(255, 107, 107, 0.9)' : 'rgba(102, 126, 234, 0.9)'};
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        z-index: 1001;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        animation: slideInDown 0.3s ease;
    `;
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 3秒后自动移除
    setTimeout(() => {
        notification.style.animation = 'slideOutUp 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 3000);
}

// 显示生成结果
function showGeneratedResult(prompt, pageCount) {
    // 创建结果展示弹窗
    const resultModal = document.createElement('div');
    resultModal.className = 'modal active';
    resultModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>绘本生成完成</h3>
                <button class="close-btn" onclick="this.closest('.modal').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="modal-body">
                <div class="result-summary">
                    <h4>生成摘要</h4>
                    <p><strong>提示词:</strong> ${prompt}</p>
                    <p><strong>页数:</strong> ${pageCount}页</p>
                    <p><strong>状态:</strong> <span style="color: #4ecdc4;">已完成</span></p>
                </div>
                <div class="action-buttons" style="margin-top: 24px; display: flex; gap: 12px;">
                    <button class="generate-btn" style="flex: 1; padding: 12px;" onclick="downloadBook()">
                        <i class="fas fa-download"></i> 下载绘本
                    </button>
                    <button class="example-btn" style="flex: 1; padding: 12px;" onclick="shareBook()">
                        <i class="fas fa-share"></i> 分享
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // 添加到页面
    document.body.appendChild(resultModal);
    
    // 添加点击外部关闭功能
    resultModal.addEventListener('click', function(e) {
        if (e.target === resultModal) {
            resultModal.remove();
        }
    });
}

// 下载绘本
function downloadBook() {
    showNotification('开始下载绘本...', 'success');
    // 这里可以添加实际的下载逻辑
    setTimeout(() => {
        showNotification('绘本下载完成！', 'success');
    }, 2000);
}

// 分享绘本
function shareBook() {
    if (navigator.share) {
        navigator.share({
            title: '我的AI绘本',
            text: '我用绘梦AI屋生成了一个有趣的绘本！',
            url: window.location.href
        }).then(() => {
            showNotification('分享成功！', 'success');
        }).catch(() => {
            showNotification('分享失败', 'error');
        });
    } else {
        // 复制链接到剪贴板
        navigator.clipboard.writeText(window.location.href).then(() => {
            showNotification('链接已复制到剪贴板', 'success');
        }).catch(() => {
            showNotification('复制失败', 'error');
        });
    }
}

// 设置示例数据
function setupExamples() {
    // 这里可以添加更多示例数据
    const examples = [
        {
            title: '宇航员小熊的冒险',
            description: '一只勇敢的小熊穿上宇航服，探索宇宙的奇妙故事',
            pages: 12
        },
        {
            title: '魔法森林的小精灵',
            description: '在神秘的魔法森林中，小精灵们帮助迷路的小动物回家',
            pages: 8
        },
        {
            title: '海底世界的友谊',
            description: '小鱼和小海龟在美丽的海底世界建立深厚友谊的故事',
            pages: 10
        }
    ];
    
    // 可以动态生成示例列表
    console.log('示例数据已加载:', examples);
}

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInDown {
        from {
            transform: translateX(-50%) translateY(-100%);
            opacity: 0;
        }
        to {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutUp {
        from {
            transform: translateX(-50%) translateY(0);
            opacity: 1;
        }
        to {
            transform: translateX(-50%) translateY(-100%);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .notification-content i {
        font-size: 18px;
    }
    
    .result-summary h4 {
        color: #4ecdc4;
        margin-bottom: 16px;
        font-size: 18px;
    }
    
    .result-summary p {
        margin-bottom: 8px;
        line-height: 1.5;
    }
    
    .action-buttons button {
        border: none;
        cursor: pointer;
        transition: all 0.3s ease;
    }
    
    .action-buttons button:hover {
        transform: translateY(-2px);
    }

    /* 绘本查看器 */
    .book-viewer-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .book-image-wrap {
        width: 100%;
        aspect-ratio: 1 / 1;
        background: rgba(0,0,0,0.2);
        border-radius: 16px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,0.1);
    }
    .book-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
    }
    .book-text {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 12px 14px;
        line-height: 1.6;
        color: #fff;
        min-height: 60px;
    }
    .book-nav {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .nav-btn { min-width: 110px; }
    .page-indicator { opacity: 0.9; font-weight: 600; }
`;
document.head.appendChild(style);

// 错误处理
window.addEventListener('error', function(e) {
    console.error('应用错误:', e.error);
    showNotification('应用出现错误，请刷新页面重试', 'error');
});

// 网络状态监听
window.addEventListener('online', function() {
    showNotification('网络连接已恢复', 'success');
});

window.addEventListener('offline', function() {
    showNotification('网络连接已断开', 'error');
});
