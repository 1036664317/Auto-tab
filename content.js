// content.js - Auto Tab Grouper 内容脚本（可选功能）

// 这个脚本主要用于在网页中显示分组信息或提供额外功能
// 对于标签分组功能来说，content script 不是必需的，但可以提供一些增强功能

console.log('Auto Tab Grouper content script 已加载');

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Content script 收到消息:', request);
    
    switch (request.action) {
        case 'getPageInfo':
            sendResponse(getPageInfo());
            break;
            
        case 'highlightPage':
            highlightPage();
            sendResponse({ success: true });
            break;
            
        default:
            sendResponse({ success: false, error: '未知操作' });
    }
    
    return true;
});

/**
 * 获取页面信息
 */
function getPageInfo() {
    return {
        title: document.title,
        url: window.location.href,
        domain: window.location.hostname,
        loadTime: Date.now(),
        hasImages: document.images.length > 0,
        hasVideos: document.querySelectorAll('video').length > 0,
        wordCount: document.body.innerText.split(/\s+/).length
    };
}

/**
 * 高亮页面（示例功能）
 */
function highlightPage() {
    // 添加一个临时的高亮效果
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 123, 255, 0.1);
        z-index: 999999;
        pointer-events: none;
        animation: fadeOut 2s ease-out forwards;
    `;
    
    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeOut {
            0% { opacity: 1; }
            100% { opacity: 0; }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(overlay);
    
    // 2秒后移除
    setTimeout(() => {
        if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        if (style.parentNode) {
            style.parentNode.removeChild(style);
        }
    }, 2000);
}

// 页面加载完成后的初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function initialize() {
    // 可以在这里添加页面加载时的初始化逻辑
    console.log('Content script 初始化完成');
}
