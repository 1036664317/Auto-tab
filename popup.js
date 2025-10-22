// popup.js - Auto Tab Grouper 弹窗脚本

document.addEventListener('DOMContentLoaded', function() {
    console.log('Auto Tab Grouper 弹窗已加载');
    
    // 初始化插件
    initializeExtension();
    
    // 绑定事件监听器
    bindEventListeners();
    
    // 更新界面状态
    updateUI();
});

/**
 * 初始化插件
 */
function initializeExtension() {
    // 从存储中加载设置
    chrome.storage.sync.get(['tabGrouperSettings'], function(result) {
        if (result.tabGrouperSettings) {
            console.log('已加载插件设置:', result.tabGrouperSettings);
            applySettings(result.tabGrouperSettings);
        } else {
            // 设置默认配置
            const defaultSettings = {
                autoGrouping: false,
                groupInterval: 60, // 分钟
                autoInterval: 5, // 分钟
                includePinned: true,
                groupingMode: 'time' // time, domain, manual
            };
            chrome.storage.sync.set({tabGrouperSettings: defaultSettings});
            applySettings(defaultSettings);
        }
    });
}

/**
 * 应用设置到界面
 */
function applySettings(settings) {
    document.getElementById('group-interval').value = settings.groupInterval || 60;
    document.getElementById('auto-interval').value = settings.autoInterval || 5;
    document.getElementById('group-pinned').checked = settings.includePinned;
    document.getElementById('auto-ungroup-on-disable').checked = settings.autoUngroupOnDisable || false;
    
    const autoToggle = document.getElementById('auto-toggle');
    const autoStatus = document.getElementById('auto-status');
    
    if (settings.autoGrouping) {
        autoToggle.classList.add('active');
        autoStatus.textContent = '已启用';
    } else {
        autoToggle.classList.remove('active');
        autoStatus.textContent = '未启用';
    }
    
    // 不需要额外的样式处理，CSS类会自动处理
}

/**
 * 绑定事件监听器
 */
function bindEventListeners() {
    // 简单开关事件
    setupSimpleToggle();
    
    // 快速操作按钮
    document.getElementById('group-by-hour').addEventListener('click', () => groupTabsByTime('hour'));
    document.getElementById('group-by-day').addEventListener('click', () => groupTabsByTime('day'));
    
    // 设置变更监听
    document.getElementById('group-interval').addEventListener('change', saveSettings);
    document.getElementById('auto-interval').addEventListener('change', saveSettings);
    document.getElementById('group-pinned').addEventListener('change', saveSettings);
    document.getElementById('auto-ungroup-on-disable').addEventListener('change', saveSettings);
}

/**
 * 设置简单开关
 */
function setupSimpleToggle() {
    const toggle = document.getElementById('auto-toggle');
    
    // 只需要点击事件
    toggle.addEventListener('click', function(e) {
        e.preventDefault();
        toggleAutoGrouping();
    });
}

/**
 * 更新界面状态
 */
async function updateUI() {
    try {
        console.log('=== 开始更新界面状态 ===');
        
        // 获取所有标签页
        const allTabs = await chrome.tabs.query({});
        const currentWindowTabs = await chrome.tabs.query({currentWindow: true});
        document.getElementById('tab-count').textContent = currentWindowTabs.length;
        
        console.log(`总标签数: ${allTabs.length}, 当前窗口标签数: ${currentWindowTabs.length}`);
        
        // 使用标签信息来构建分组数据
        const groupData = await buildGroupDataFromTabs(allTabs);
        
        document.getElementById('group-count').textContent = groupData.length;
        
        // 更新分组列表
        updateGroupsList(groupData);
        
        console.log(`界面更新完成: ${currentWindowTabs.length} 个标签, ${groupData.length} 个分组`);
        
    } catch (error) {
        console.error('更新界面状态失败:', error);
    }
}

/**
 * 从标签信息构建分组数据
 */
async function buildGroupDataFromTabs(allTabs) {
    try {
        // 找出所有分组的标签
        const groupedTabs = allTabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);
        console.log(`找到 ${groupedTabs.length} 个分组标签`);
        
        if (groupedTabs.length === 0) {
            return [];
        }
        
        // 按分组ID分类
        const groupMap = new Map();
        groupedTabs.forEach(tab => {
            if (!groupMap.has(tab.groupId)) {
                groupMap.set(tab.groupId, []);
            }
            groupMap.get(tab.groupId).push(tab);
        });
        
        console.log(`找到 ${groupMap.size} 个不同的分组`);
        
        // 获取分组详细信息
        const groupData = [];
        for (const [groupId, tabs] of groupMap) {
            try {
                // 尝试获取分组信息
                const groupInfo = await chrome.tabGroups.get(groupId);
                groupData.push({
                    id: groupId,
                    title: groupInfo.title || '未命名分组',
                    color: groupInfo.color,
                    tabIds: tabs.map(tab => tab.id),
                    tabCount: tabs.length,
                    tabs: tabs
                });
                console.log(`分组 ${groupId}: "${groupInfo.title}", ${tabs.length} 个标签`);
            } catch (error) {
                console.error(`获取分组 ${groupId} 信息失败:`, error);
                // 即使获取分组信息失败，也要显示基本信息
                groupData.push({
                    id: groupId,
                    title: '未命名分组',
                    color: 'grey',
                    tabIds: tabs.map(tab => tab.id),
                    tabCount: tabs.length,
                    tabs: tabs
                });
            }
        }
        
        return groupData;
    } catch (error) {
        console.error('构建分组数据失败:', error);
        return [];
    }
}

/**
 * 更新分组列表显示
 */
function updateGroupsList(groups) {
    const groupsList = document.getElementById('groups-list');
    
    console.log('=== 更新分组列表显示 ===');
    console.log(`收到 ${groups.length} 个分组数据`);
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<div class="no-groups">暂无分组</div>';
        console.log('没有分组，显示空状态');
        return;
    }
    
    groupsList.innerHTML = '';
    groups.forEach((group, index) => {
        const groupItem = document.createElement('div');
        groupItem.className = 'group-item';
        
        // 使用新的数据结构
        const tabCount = group.tabCount || (group.tabIds ? group.tabIds.length : 0);
        const groupTitle = group.title || '未命名分组';
        
        console.log(`分组 ${index + 1}: "${groupTitle}", 标签数: ${tabCount}, ID: ${group.id}`);
        
        // 添加颜色指示器
        const colorDot = group.color ? `<span class="group-color" style="background-color: var(--group-${group.color}, #666);"></span>` : '';
        
        groupItem.innerHTML = `
            ${colorDot}
            <span class="group-name">${groupTitle}</span>
            <span class="group-count">${tabCount}</span>
        `;
        groupsList.appendChild(groupItem);
        
        // 验证数据
        if (tabCount === 0) {
            console.warn(`⚠️ 分组 "${groupTitle}" 显示标签数为0，可能有问题`);
            console.log('分组详细信息:', group);
        }
    });
    
    console.log('分组列表更新完成');
}

/**
 * 切换自动分组状态
 */
function toggleAutoGrouping() {
    chrome.storage.sync.get(['tabGrouperSettings'], function(result) {
        const settings = result.tabGrouperSettings || {};
        const newState = !settings.autoGrouping;
        settings.autoGrouping = newState;
        
        // 先更新界面状态
        applySettings(settings);
        showNotification(newState ? '正在启用自动分组并立即分组...' : '正在关闭自动分组...', 'info');
        
        chrome.storage.sync.set({tabGrouperSettings: settings}, function() {
            // 通知background script
            chrome.runtime.sendMessage({
                action: 'toggleAutoGrouping',
                enabled: settings.autoGrouping
            }, function(response) {
                console.log('自动分组切换响应:', response);
                
                if (chrome.runtime.lastError) {
                    console.error('Runtime错误:', chrome.runtime.lastError);
                    showNotification('操作失败: ' + chrome.runtime.lastError.message, 'error');
                    // 恢复原状态
                    settings.autoGrouping = !newState;
                    applySettings(settings);
                    return;
                }
                
                if (response && response.success) {
                    if (settings.autoGrouping) {
                        // 开启自动分组时立即执行一次分组
                        showNotification('自动分组已开启，正在执行分组...', 'info');
                        performImmediateGrouping();
                    } else {
                        showNotification('自动分组已关闭，现有分组保持不变');
                    }
                } else {
                    showNotification('操作失败，请重试', 'error');
                    // 恢复原状态
                    settings.autoGrouping = !newState;
                    applySettings(settings);
                }
            });
        });
    });
}

/**
 * 执行立即分组（内部函数）
 */
function performImmediateGrouping() {
    chrome.runtime.sendMessage({
        action: 'groupTabsNow'
    }, function(response) {
        console.log('立即分组响应:', response);
        
        if (chrome.runtime.lastError) {
            console.error('Runtime错误:', chrome.runtime.lastError);
            showNotification('分组失败: ' + chrome.runtime.lastError.message, 'error');
            return;
        }
        
        if (response && response.success) {
            const message = `自动分组已启用并成功创建 ${response.groupsCreated} 个分组`;
            showNotification(message);
            // 延迟更新界面，确保分组操作完成
            setTimeout(() => {
                console.log('分组操作完成，开始更新界面...');
                updateUI();
            }, 1000);
        } else {
            showNotification('分组失败，但自动分组功能已启用', 'warning');
            updateUI();
        }
    });
}


/**
 * 按时间分组
 */
function groupTabsByTime(timeUnit) {
    chrome.runtime.sendMessage({
        action: 'groupTabsByTime',
        timeUnit: timeUnit
    }, function(response) {
        if (response && response.success) {
            showNotification(`按${timeUnit === 'hour' ? '小时' : '天'}分组成功`);
            updateUI();
        } else {
            showNotification('分组失败，请重试', 'error');
        }
    });
}


/**
 * 保存设置
 */
function saveSettings() {
    const groupIntervalValue = document.getElementById('group-interval').value;
    const settings = {
        groupInterval: groupIntervalValue === 'am_pm' ? 'am_pm' : parseInt(groupIntervalValue),
        autoInterval: parseInt(document.getElementById('auto-interval').value),
        includePinned: document.getElementById('group-pinned').checked,
        autoUngroupOnDisable: document.getElementById('auto-ungroup-on-disable').checked
    };
    
    chrome.storage.sync.get(['tabGrouperSettings'], function(result) {
        const currentSettings = result.tabGrouperSettings || {};
        const newSettings = {...currentSettings, ...settings};
        
        chrome.storage.sync.set({tabGrouperSettings: newSettings}, function() {
            // 通知background script设置已更新
            chrome.runtime.sendMessage({
                action: 'settingsUpdated',
                settings: newSettings
            });
            
            showNotification('设置已保存');
        });
    });
}

/**
 * 显示通知
 */
function showNotification(message, type = 'success') {
    // 移除现有通知
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // 获取通知颜色
    let backgroundColor;
    switch (type) {
        case 'error':
            backgroundColor = '#dc3545';
            break;
        case 'info':
            backgroundColor = '#17a2b8';
            break;
        case 'warning':
            backgroundColor = '#ffc107';
            break;
        default: // success
            backgroundColor = '#28a745';
    }
    
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: ${backgroundColor};
        color: ${type === 'warning' ? '#333' : 'white'};
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 12px;
        z-index: 1000;
        animation: slideIn 0.3s ease-out;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        max-width: 250px;
        word-wrap: break-word;
    `;
    notification.textContent = message;
    
    // 添加动画样式（只添加一次）
    if (!document.querySelector('#notification-styles')) {
        const style = document.createElement('style');
        style.id = 'notification-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
    
    // 添加到页面
    document.body.appendChild(notification);
    
    // 根据类型设置不同的显示时间
    const displayTime = type === 'info' ? 2000 : 3000;
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, displayTime);
}

/**
 * 格式化时间
 */
function formatTime(date) {
    return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * 获取时间分组名称
 */
function getTimeGroupName(date, interval) {
    const now = new Date();
    const diffMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffMinutes < interval) {
        return '最近打开';
    } else if (diffMinutes < interval * 2) {
        return `${interval}分钟前`;
    } else if (diffMinutes < 60) {
        return '1小时内';
    } else if (diffMinutes < 60 * 24) {
        return '今天';
    } else {
        return '更早';
    }
}
