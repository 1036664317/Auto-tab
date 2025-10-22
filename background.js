// background.js - Auto Tab Grouper 后台服务脚本

// 全局变量
let autoGroupingEnabled = false;
let autoGroupingInterval = null;
let settings = {
    autoGrouping: false,
    groupInterval: 60, // 分钟 或 'am_pm'
    autoInterval: 5, // 分钟
    includePinned: true,
    groupingMode: 'time'
};

// 标签创建时间跟踪
const tabCreationTimes = new Map();

// 插件启动时初始化
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

/**
 * 初始化插件
 */
async function initialize() {
    console.log('Auto Tab Grouper 后台服务已启动');
    
    // 加载设置
    await loadSettings();
    
    // 设置标签事件监听器
    setupTabListeners();
    
    // 如果自动分组已启用，启动定时器
    if (settings.autoGrouping) {
        startAutoGrouping();
    }
}

/**
 * 加载设置
 */
async function loadSettings() {
    try {
        const result = await chrome.storage.sync.get(['tabGrouperSettings']);
        if (result.tabGrouperSettings) {
            settings = { ...settings, ...result.tabGrouperSettings };
            autoGroupingEnabled = settings.autoGrouping;
        }
        console.log('已加载设置:', settings);
    } catch (error) {
        console.error('加载设置失败:', error);
    }
}

/**
 * 设置标签事件监听器
 */
function setupTabListeners() {
    // 标签创建时记录时间
    chrome.tabs.onCreated.addListener((tab) => {
        tabCreationTimes.set(tab.id, Date.now());
        console.log(`标签 ${tab.id} 创建时间已记录`);
    });
    
    // 标签移除时清理记录
    chrome.tabs.onRemoved.addListener((tabId) => {
        tabCreationTimes.delete(tabId);
        console.log(`标签 ${tabId} 记录已清理`);
    });
    
    // 标签更新时可能需要重新分组
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && autoGroupingEnabled) {
            // 延迟执行，避免频繁分组
            setTimeout(() => {
                if (settings.autoGrouping) {
                    performAutoGrouping();
                }
            }, 2000);
        }
    });
}

/**
 * 消息监听器
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('收到消息:', request);
    
    switch (request.action) {
        case 'toggleAutoGrouping':
            handleToggleAutoGrouping(request.enabled, sendResponse);
            break;
            
        case 'groupTabsNow':
            handleGroupTabsNow(sendResponse);
            break;
            
        case 'groupTabsByTime':
            handleGroupTabsByTime(request.timeUnit, sendResponse);
            break;
            
            
        case 'settingsUpdated':
            handleSettingsUpdated(request.settings, sendResponse);
            break;
            
        default:
            sendResponse({ success: false, error: '未知操作' });
    }
    
    return true; // 保持消息通道开放
});

/**
 * 处理自动分组开关
 */
async function handleToggleAutoGrouping(enabled, sendResponse) {
    try {
        autoGroupingEnabled = enabled;
        settings.autoGrouping = enabled;
        
        // 保存设置
        await chrome.storage.sync.set({ tabGrouperSettings: settings });
        
        if (enabled) {
            startAutoGrouping();
            console.log('自动分组已启用');
        } else {
            stopAutoGrouping();
            console.log('自动分组已禁用');
            
            // 根据用户设置决定是否自动取消现有分组
            if (settings.autoUngroupOnDisable) {
                try {
                    console.log('=== 关闭自动分组时自动取消分组 ===');
                    
                    // 使用相同的可靠方法
                    const allTabs = await chrome.tabs.query({});
                    const groupedTabs = allTabs.filter(tab => tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE);
                    
                    console.log(`找到 ${groupedTabs.length} 个分组标签`);
                    
                    if (groupedTabs.length > 0) {
                        const groupMap = new Map();
                        groupedTabs.forEach(tab => {
                            if (!groupMap.has(tab.groupId)) {
                                groupMap.set(tab.groupId, []);
                            }
                            groupMap.get(tab.groupId).push(tab.id);
                        });
                        
                        let ungroupedCount = 0;
                        for (const [groupId, tabIds] of groupMap) {
                            try {
                                await chrome.tabs.ungroup(tabIds);
                                ungroupedCount++;
                            } catch (ungroupError) {
                                console.error(`取消分组 ${groupId} 失败:`, ungroupError);
                            }
                        }
                        
                        console.log(`已自动取消 ${ungroupedCount} 个分组`);
                    }
                } catch (ungroupError) {
                    console.error('自动取消分组失败:', ungroupError);
                }
            }
        }
        
        sendResponse({ success: true });
    } catch (error) {
        console.error('切换自动分组失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 处理立即分组
 */
async function handleGroupTabsNow(sendResponse) {
    try {
        const result = await performTimeBasedGrouping();
        sendResponse({ 
            success: true, 
            groupsCreated: result.groupsCreated,
            message: `成功创建 ${result.groupsCreated} 个分组`
        });
    } catch (error) {
        console.error('立即分组失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 处理按时间分组
 */
async function handleGroupTabsByTime(timeUnit, sendResponse) {
    try {
        const result = await performTimeBasedGrouping(timeUnit);
        sendResponse({ 
            success: true, 
            groupsCreated: result.groupsCreated,
            timeUnit: timeUnit
        });
    } catch (error) {
        console.error('按时间分组失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}


/**
 * 处理设置更新
 */
async function handleSettingsUpdated(newSettings, sendResponse) {
    try {
        settings = { ...settings, ...newSettings };
        await chrome.storage.sync.set({ tabGrouperSettings: settings });
        
        // 如果自动分组间隔改变，重启定时器
        if (autoGroupingEnabled) {
            stopAutoGrouping();
            startAutoGrouping();
        }
        
        sendResponse({ success: true });
    } catch (error) {
        console.error('更新设置失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * 启动自动分组
 */
function startAutoGrouping() {
    if (autoGroupingInterval) {
        clearInterval(autoGroupingInterval);
    }
    
    const intervalMs = settings.autoInterval * 60 * 1000; // 转换为毫秒
    autoGroupingInterval = setInterval(performAutoGrouping, intervalMs);
    
    console.log(`自动分组已启动，间隔: ${settings.autoInterval} 分钟`);
}

/**
 * 停止自动分组
 */
function stopAutoGrouping() {
    if (autoGroupingInterval) {
        clearInterval(autoGroupingInterval);
        autoGroupingInterval = null;
    }
    console.log('自动分组已停止');
}

/**
 * 执行自动分组
 */
async function performAutoGrouping() {
    if (!autoGroupingEnabled) return;
    
    try {
        console.log('执行自动分组...');
        await performTimeBasedGrouping();
    } catch (error) {
        console.error('自动分组执行失败:', error);
    }
}

/**
 * 执行基于时间的分组
 */
async function performTimeBasedGrouping(timeUnit = 'auto') {
    try {
        const windows = await chrome.windows.getAll();
        let totalGroupsCreated = 0;
        
        for (const window of windows) {
            const tabs = await chrome.tabs.query({ windowId: window.id });
            const groupsCreated = await groupTabsByTimeInWindow(tabs, timeUnit);
            totalGroupsCreated += groupsCreated;
        }
        
        console.log(`时间分组完成，共创建 ${totalGroupsCreated} 个分组`);
        return { groupsCreated: totalGroupsCreated };
        
    } catch (error) {
        console.error('时间分组失败:', error);
        throw error;
    }
}

/**
 * 在指定窗口中按时间分组标签
 */
async function groupTabsByTimeInWindow(tabs, timeUnit) {
    const now = Date.now();
    const groupInterval = settings.groupInterval * 60 * 1000; // 转换为毫秒
    const timeGroups = new Map();
    
    // 过滤标签（排除已分组的和固定的标签，如果设置不包含固定标签）
    const ungroupedTabs = tabs.filter(tab => {
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return false;
        if (!settings.includePinned && tab.pinned) return false;
        return true;
    });
    
    // 按时间分组标签
    for (const tab of ungroupedTabs) {
        const creationTime = tabCreationTimes.get(tab.id) || now;
        const actualInterval = settings.groupInterval === 'am_pm' ? 'am_pm' : groupInterval;
        const groupKey = getTimeGroupKey(creationTime, now, actualInterval, timeUnit);
        
        if (!timeGroups.has(groupKey)) {
            timeGroups.set(groupKey, []);
        }
        timeGroups.get(groupKey).push(tab);
    }
    
    // 创建分组
    let groupsCreated = 0;
    for (const [groupKey, groupTabs] of timeGroups) {
        if (groupTabs.length >= 1) { // 改为1个标签也可以创建分组
            try {
                const tabIds = groupTabs.map(tab => tab.id);
                const groupId = await chrome.tabs.group({ tabIds });
                
                // 设置分组标题和颜色
                const groupTitle = getGroupTitle(groupKey, timeUnit);
                const groupColor = getGroupColor(groupKey);
                
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    color: groupColor
                });
                
                groupsCreated++;
                console.log(`创建分组: ${groupTitle}，包含 ${tabIds.length} 个标签`);
                
            } catch (error) {
                console.error('创建分组失败:', error);
            }
        } else {
            console.log(`跳过空分组: ${groupKey}`);
        }
    }
    
    return groupsCreated;
}

/**
 * 获取时间分组键
 */
function getTimeGroupKey(creationTime, currentTime, interval, timeUnit) {
    const diffMs = currentTime - creationTime;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const creationDate = new Date(creationTime);
    const currentDate = new Date(currentTime);
    
    switch (timeUnit) {
        case 'hour':
            return Math.floor(diffMinutes / 60);
        case 'day':
            return Math.floor(diffMinutes / (60 * 24));
        default: // 'auto'
            // 特殊处理上午下午分组
            if (interval === 'am_pm') {
                return getAmPmGroupKey(creationDate, currentDate);
            }
            
            if (diffMinutes < interval) {
                return 'recent';
            } else if (diffMinutes < interval * 2) {
                return 'interval1';
            } else if (diffMinutes < 60) {
                return 'hour';
            } else if (diffMinutes < 60 * 24) {
                return 'today';
            } else {
                return 'older';
            }
    }
}

/**
 * 获取上午下午分组键
 */
function getAmPmGroupKey(creationDate, currentDate) {
    const creationHour = creationDate.getHours();
    const currentHour = currentDate.getHours();
    
    // 判断是否为同一天
    const isSameDay = creationDate.toDateString() === currentDate.toDateString();
    
    if (isSameDay) {
        // 同一天，按上午下午分组
        if (creationHour < 12 && currentHour < 12) {
            return 'current_morning';
        } else if (creationHour >= 12 && currentHour >= 12) {
            return 'current_afternoon';
        } else if (creationHour < 12 && currentHour >= 12) {
            return 'this_morning';
        } else {
            return 'current_afternoon';
        }
    } else {
        // 不同天，按日期和上午下午分组
        const daysDiff = Math.floor((currentDate - creationDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff === 1) {
            // 昨天
            return creationHour < 12 ? 'yesterday_morning' : 'yesterday_afternoon';
        } else if (daysDiff < 7) {
            // 本周内
            return creationHour < 12 ? `${daysDiff}days_morning` : `${daysDiff}days_afternoon`;
        } else {
            // 更早
            return 'older';
        }
    }
}

/**
 * 获取分组标题
 */
function getGroupTitle(groupKey, timeUnit) {
    switch (timeUnit) {
        case 'hour':
            return groupKey === 0 ? '最近1小时' : `${groupKey}小时前`;
        case 'day':
            return groupKey === 0 ? '今天' : `${groupKey}天前`;
        default:
            // 处理上午下午分组的标题
            if (settings.groupInterval === 'am_pm') {
                return getAmPmGroupTitle(groupKey);
            }
            
            switch (groupKey) {
                case 'recent':
                    return '最近打开';
                case 'interval1':
                    return `${settings.groupInterval}分钟前`;
                case 'hour':
                    return '1小时内';
                case 'today':
                    return '今天';
                case 'older':
                    return '更早';
                default:
                    return '未分类';
            }
    }
}

/**
 * 获取上午下午分组标题
 */
function getAmPmGroupTitle(groupKey) {
    switch (groupKey) {
        case 'current_morning':
            return '今天上午';
        case 'current_afternoon':
            return '今天下午';
        case 'this_morning':
            return '今天上午';
        case 'yesterday_morning':
            return '昨天上午';
        case 'yesterday_afternoon':
            return '昨天下午';
        case 'older':
            return '更早';
        default:
            // 处理多天前的情况
            if (groupKey.includes('days_morning')) {
                const days = groupKey.split('days_')[0];
                return `${days}天前上午`;
            } else if (groupKey.includes('days_afternoon')) {
                const days = groupKey.split('days_')[0];
                return `${days}天前下午`;
            }
            return '未分类';
    }
}

/**
 * 获取分组颜色
 */
function getGroupColor(groupKey) {
    const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
    
    // 处理上午下午分组的颜色
    if (settings.groupInterval === 'am_pm') {
        return getAmPmGroupColor(groupKey);
    }
    
    switch (groupKey) {
        case 'recent':
            return 'green';
        case 'interval1':
            return 'blue';
        case 'hour':
            return 'yellow';
        case 'today':
            return 'orange';
        case 'older':
            return 'red';
        default:
            // 根据groupKey的哈希值选择颜色
            const hash = typeof groupKey === 'string' ? 
                groupKey.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 
                groupKey;
            return colors[hash % colors.length];
    }
}

/**
 * 获取上午下午分组颜色
 */
function getAmPmGroupColor(groupKey) {
    switch (groupKey) {
        case 'current_morning':
            return 'green';      // 今天上午 - 绿色
        case 'current_afternoon':
            return 'blue';       // 今天下午 - 蓝色
        case 'this_morning':
            return 'green';      // 今天上午 - 绿色
        case 'yesterday_morning':
            return 'yellow';     // 昨天上午 - 黄色
        case 'yesterday_afternoon':
            return 'orange';     // 昨天下午 - 橙色
        case 'older':
            return 'red';        // 更早 - 红色
        default:
            // 处理多天前的情况
            if (groupKey.includes('days_morning')) {
                return 'purple';  // 几天前上午 - 紫色
            } else if (groupKey.includes('days_afternoon')) {
                return 'pink';    // 几天前下午 - 粉色
            }
            return 'cyan';       // 默认 - 青色
    }
}

/**
 * 清理过期的标签创建时间记录
 */
function cleanupTabCreationTimes() {
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天
    
    for (const [tabId, creationTime] of tabCreationTimes) {
        if (now - creationTime > maxAge) {
            tabCreationTimes.delete(tabId);
        }
    }
}

// 定期清理过期记录
setInterval(cleanupTabCreationTimes, 60 * 60 * 1000); // 每小时清理一次

console.log('Auto Tab Grouper 后台服务脚本已加载');
