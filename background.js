// background.js - Auto Tab Grouper 后台服务脚本

// 全局变量
let autoGroupingEnabled = false;
let autoGroupingInterval = null;
let settings = {
    autoGrouping: false,
    groupInterval: 60, // 分钟 或 'am_pm'
    autoInterval: 5, // 分钟
    includePinned: true,
    groupingMode: 'time',
    autoCollapse: true  // 分组后自动折叠
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
    
    // 初始化现有标签的创建时间
    await initializeExistingTabs();
    
    // 设置标签事件监听器
    setupTabListeners();
    
    // 如果自动分组已启用，启动定时器
    if (settings.autoGrouping) {
        startAutoGrouping();
    }
}

/**
 * 初始化现有标签的创建时间
 */
async function initializeExistingTabs() {
    try {
        const allTabs = await chrome.tabs.query({});
        const now = Date.now();
        
        console.log(`初始化 ${allTabs.length} 个现有标签的创建时间`);
        
        for (const tab of allTabs) {
            if (!tabCreationTimes.has(tab.id)) {
                // 对于已存在的标签，我们假设它们是在不同时间段创建的
                // 使用一个随机的时间偏移，模拟不同的创建时间
                // 这样可以更好地测试分组功能
                const randomOffset = Math.floor(Math.random() * 120 * 60 * 1000); // 0-120分钟前
                tabCreationTimes.set(tab.id, now - randomOffset);
                console.log(`标签 ${tab.id} 初始化时间: ${Math.floor(randomOffset / 60000)}分钟前`);
            }
        }
    } catch (error) {
        console.error('初始化现有标签时间失败:', error);
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
    
    console.log('=== 开始按时间分组标签 ===');
    console.log(`当前时间: ${new Date(now).toLocaleString()}`);
    console.log(`分组间隔设置: ${settings.groupInterval} 分钟 (${settings.groupInterval === 'am_pm' ? '上午/下午模式' : groupInterval + '毫秒'})`);
    console.log(`时间单位: ${timeUnit}`);
    console.log(`总标签数: ${tabs.length}`);
    
    // 过滤标签（排除已分组的和固定的标签，如果设置不包含固定标签）
    const ungroupedTabs = tabs.filter(tab => {
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            console.log(`跳过已分组标签: ${tab.id} (分组ID: ${tab.groupId})`);
            return false;
        }
        if (!settings.includePinned && tab.pinned) {
            console.log(`跳过固定标签: ${tab.id}`);
            return false;
        }
        return true;
    });
    
    console.log(`待分组标签数: ${ungroupedTabs.length}`);
    
    // 按时间分组标签
    for (const tab of ungroupedTabs) {
        const creationTime = tabCreationTimes.get(tab.id) || now;
        const ageMinutes = Math.floor((now - creationTime) / (1000 * 60));
        const actualInterval = settings.groupInterval === 'am_pm' ? 'am_pm' : groupInterval;
        const groupKey = getTimeGroupKey(creationTime, now, actualInterval, timeUnit);
        
        console.log(`标签 ${tab.id}: "${tab.title.substring(0, 30)}..." - 年龄: ${ageMinutes}分钟 -> 分组: ${groupKey}`);
        
        if (!timeGroups.has(groupKey)) {
            timeGroups.set(groupKey, []);
        }
        timeGroups.get(groupKey).push(tab);
    }
    
    console.log(`\n总共创建 ${timeGroups.size} 个时间分组:`);
    for (const [key, tabs] of timeGroups) {
        console.log(`  - ${key}: ${tabs.length} 个标签`);
    }
    
    // 创建分组
    let groupsCreated = 0;
    for (const [groupKey, groupTabs] of timeGroups) {
        if (groupTabs.length >= 1) { // 改为1个标签也可以创建分组
            try {
                const tabIds = groupTabs.map(tab => tab.id);
                const groupId = await chrome.tabs.group({ tabIds });
                
                // 设置分组标题、颜色和折叠状态
                const groupTitle = getGroupTitle(groupKey, timeUnit);
                const groupColor = getGroupColor(groupKey);
                
                await chrome.tabGroups.update(groupId, {
                    title: groupTitle,
                    color: groupColor,
                    collapsed: settings.autoCollapse !== false  // 默认折叠，除非设置明确禁用
                });
                
                groupsCreated++;
                console.log(`✓ 创建分组: "${groupTitle}" (${groupColor})，包含 ${tabIds.length} 个标签 [已折叠]`);
                
            } catch (error) {
                console.error('创建分组失败:', error);
            }
        } else {
            console.log(`跳过空分组: ${groupKey}`);
        }
    }
    
    console.log(`=== 分组完成，共创建 ${groupsCreated} 个分组 ===\n`);
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
            
            // 将间隔从毫秒转换为分钟
            const intervalMinutes = typeof interval === 'number' ? Math.floor(interval / (1000 * 60)) : 60;
            
            console.log(`  计算分组键: 年龄=${diffMinutes}分钟, 间隔=${intervalMinutes}分钟`);
            
            // 按照设置的时间间隔进行分组
            if (diffMinutes < intervalMinutes) {
                return `recent_${intervalMinutes}`;  // 最近N分钟内
            } else if (diffMinutes < intervalMinutes * 2) {
                return `interval_${intervalMinutes}_1`;  // N分钟到2N分钟
            } else if (diffMinutes < intervalMinutes * 3) {
                return `interval_${intervalMinutes}_2`;  // 2N分钟到3N分钟
            } else if (diffMinutes < 60 * 24) {
                // 超过3倍间隔但在24小时内，按小时分组
                const hoursAgo = Math.floor(diffMinutes / 60);
                return `hours_${hoursAgo}`;
            } else {
                // 超过24小时，按天分组
                const daysAgo = Math.floor(diffMinutes / (60 * 24));
                return `days_${daysAgo}`;
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
            
            // 处理新的分组键格式
            if (typeof groupKey === 'string') {
                if (groupKey.startsWith('recent_')) {
                    const minutes = groupKey.split('_')[1];
                    return `最近${minutes}分钟`;
                } else if (groupKey.startsWith('interval_')) {
                    const parts = groupKey.split('_');
                    const minutes = parts[1];
                    const multiplier = parseInt(parts[2]) + 1;
                    return `${minutes * multiplier}分钟前`;
                } else if (groupKey.startsWith('hours_')) {
                    const hours = groupKey.split('_')[1];
                    return `${hours}小时前`;
                } else if (groupKey.startsWith('days_')) {
                    const days = groupKey.split('_')[1];
                    return `${days}天前`;
                }
            }
            
            // 旧版本兼容
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
    
    // 处理新的分组键格式
    if (typeof groupKey === 'string') {
        if (groupKey.startsWith('recent_')) {
            return 'green';  // 最近的标签 - 绿色
        } else if (groupKey.startsWith('interval_') && groupKey.endsWith('_1')) {
            return 'blue';   // 第一个间隔 - 蓝色
        } else if (groupKey.startsWith('interval_') && groupKey.endsWith('_2')) {
            return 'cyan';   // 第二个间隔 - 青色
        } else if (groupKey.startsWith('hours_')) {
            return 'yellow'; // 按小时 - 黄色
        } else if (groupKey.startsWith('days_')) {
            const days = parseInt(groupKey.split('_')[1]);
            if (days === 1) return 'orange';  // 1天前 - 橙色
            return 'red';    // 更早 - 红色
        }
    }
    
    // 旧版本兼容
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
