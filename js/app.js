// Application state with context-aware parameters
let currentParameters = {
    // Legacy parameters for backward compatibility
    directness: 75,
    confidence: 60,
    disagreement: 40,
    formality: 70,
    
    // Context-aware parameter storage
    _context: 'mixed', // Default to mixed for backward compatibility
    _contextParameters: {
        personal: {
            empathy: 65,
            supportiveness: 70,
            creativity: 60,
            warmth: 75,
            responseLength: 60
        },
        professional: {
            efficiency: 75,
            formality: 80,
            challenge: 60,
            levelOfSophistication: 60,
            responseLength: 10
        },
        mixed: {
            adaptability: 70,
            balance: 65,
            directness: 75,
            creativity: 60,
            responseLength: 60
        }
    }
};

// Context-aware parameter management functions
function getCurrentContextParameters() {
    const context = currentParameters._context || 'mixed';
    return currentParameters._contextParameters[context] || currentParameters._contextParameters.mixed;
}

function setCurrentContext(context) {
    if (!currentParameters._contextParameters[context]) {
        console.warn(`Invalid context: ${context}, defaulting to mixed`);
        context = 'mixed';
    }
    currentParameters._context = context;
    
    // Update legacy parameters for backward compatibility
    updateLegacyParameters();
}

function updateContextParameters(context, newParams) {
    if (!currentParameters._contextParameters[context]) {
        console.warn(`Invalid context: ${context}`);
        return;
    }
    
    currentParameters._contextParameters[context] = { ...newParams };
    
    // If this is the current context, update legacy parameters
    if (currentParameters._context === context) {
        updateLegacyParameters();
    }
}

function updateLegacyParameters() {
    const context = currentParameters._context || 'mixed';
    const contextParams = getCurrentContextParameters();
    
    // Map context-specific parameters to legacy parameters for backward compatibility
    switch (context) {
        case 'personal':
            currentParameters.directness = Math.round((contextParams.warmth + contextParams.empathy) / 2);
            currentParameters.confidence = Math.round((contextParams.supportiveness + contextParams.creativity) / 2);
            currentParameters.disagreement = Math.round(100 - contextParams.supportiveness);
            currentParameters.formality = Math.round(100 - contextParams.warmth);
            break;
            
        case 'professional':
            currentParameters.directness = Math.round((contextParams.authority + contextParams.challenge) / 2);
            currentParameters.confidence = Math.round((contextParams.authority + contextParams.efficiency) / 2);
            currentParameters.disagreement = contextParams.challenge;
            currentParameters.formality = contextParams.formality;
            break;
            
        case 'mixed':
        default:
            currentParameters.directness = contextParams.directness;
            currentParameters.confidence = contextParams.confidence;
            currentParameters.disagreement = Math.round(100 - contextParams.balance);
            currentParameters.formality = Math.round(100 - contextParams.adaptability);
            break;
    }
}

function migrateToContextAware(legacyParams) {
    // Migrate existing parameters to mixed context as default
    if (!legacyParams._context) {
        const mixed = {
            adaptability: Math.round(100 - (legacyParams.formality || 70)),
            balance: Math.round(100 - (legacyParams.disagreement || 40)),
            directness: legacyParams.directness || 75,
            confidence: legacyParams.confidence || 60
        };
        
        return {
            ...legacyParams,
            _context: 'mixed',
            _contextParameters: {
                ...currentParameters._contextParameters,
                mixed: mixed
            }
        };
    }
    return legacyParams;
}

let messageHistory = [];
let disagreementCount = 0;
let pushbackCount = 0;
let config = null;
let selectedModel = 'openai/gpt-4';

// Attachment handling configuration
const ATTACHMENT_LIMIT = 5;
const ATTACHMENT_SIZE_LIMIT = 4 * 1024 * 1024; // 4 MB per file to keep demo responsive
const ALLOWED_ATTACHMENT_TYPES = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/json',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];
const ALLOWED_ATTACHMENT_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.pdf', '.txt', '.md', '.json', '.csv',
    '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
];
let pendingAttachments = [];

// Chat management system
class ChatManager {
    constructor() {
        this.currentChatId = null;
        this.chats = {};
        this.loadFromStorage();
    }

    // Generate unique chat ID
    generateChatId() {
        return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Generate chat title from first user message
    generateChatTitle(firstMessage) {
        if (!firstMessage) return 'New Chat';
        const title = firstMessage.length > 30 
            ? firstMessage.substring(0, 30) + '...' 
            : firstMessage;
        return title;
    }

    // Create new chat
    createNewChat() {
        // Save current chat if it has messages
        if (this.currentChatId && messageHistory.length > 0) {
            this.saveCurrentChat();
        }

        // Create new chat with current timestamp to ensure it appears at top
        const chatId = this.generateChatId();
        const now = Date.now();
        this.currentChatId = chatId;
        this.chats[chatId] = {
            title: 'New Chat',
            messages: [],
            parameters: {...currentParameters},
            createdAt: now,
            lastActive: now + 1 // Ensure it's newer than any existing chat
        };

        // Reset current session
        messageHistory = [];
        disagreementCount = 0;
        pushbackCount = 0;
        clearPendingAttachments(true);
        
        this.saveToStorage();
        return chatId;
    }

    // Save current chat session
    saveCurrentChat() {
        if (!this.currentChatId) return;

        if (this.chats[this.currentChatId]) {
            this.chats[this.currentChatId].messages = [...messageHistory];
            this.chats[this.currentChatId].parameters = {...currentParameters};
            this.chats[this.currentChatId].lastActive = Date.now();
            
            // Update title from first user message if still 'New Chat'
            if (this.chats[this.currentChatId].title === 'New Chat' && messageHistory.length > 0) {
                const firstUserMessage = messageHistory.find(msg => msg.sender === 'user');
                if (firstUserMessage) {
                    const previewText = getMessagePreviewText(firstUserMessage);
                    if (previewText) {
                        this.chats[this.currentChatId].title = this.generateChatTitle(previewText);
                    }
                }
            }
        }
        
        this.saveToStorage();
    }

    // Load specific chat
    loadChat(chatId) {
        if (!this.chats[chatId]) return false;

        // Save current chat before switching
        this.saveCurrentChat();

        // Load selected chat
        const chat = this.chats[chatId];
        this.currentChatId = chatId;
        messageHistory = [...chat.messages];
        clearPendingAttachments(true);
        
        // Handle parameter migration for backward compatibility
        const loadedParameters = migrateToContextAware(chat.parameters || {});
        currentParameters = { ...currentParameters, ...loadedParameters };
        
        // Set context if available
        if (loadedParameters._context) {
            setCurrentContext(loadedParameters._context);
        }
        
        // Update UI sliders
        this.updateParameterSliders();
        
        // Update counters
        disagreementCount = 0;
        pushbackCount = 0;
        
        // Update last active
        chat.lastActive = Date.now();
        this.saveToStorage();
        
        return true;
    }

    // Update parameter sliders in UI for context-aware system
    updateParameterSliders() {
        const context = currentParameters._context || 'mixed';
        const contextParams = getCurrentContextParameters();
        
        // Update context selector active state
        document.querySelectorAll('.context-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-context') === context);
        });
        
        // Regenerate dynamic parameters to reflect current values
        generateDynamicParameters();
    }

    // Get all chats sorted by last active (most recent first)
    getAllChats() {
        return Object.entries(this.chats)
            .map(([id, chat]) => ({id, ...chat}))
            .sort((a, b) => b.lastActive - a.lastActive);
    }

    // Save to localStorage
    saveToStorage() {
        try {
            const data = {
                currentChatId: this.currentChatId,
                chats: this.chats
            };
            localStorage.setItem('zero_chats', JSON.stringify(data));
        } catch (error) {
            console.error('Failed to save chats to storage:', error);
        }
    }

    // Load from localStorage
    loadFromStorage() {
        try {
            const data = localStorage.getItem('zero_chats');
            if (data) {
                const parsed = JSON.parse(data);
                this.currentChatId = parsed.currentChatId;
                this.chats = parsed.chats || {};
            }
        } catch (error) {
            console.error('Failed to load chats from storage:', error);
            this.chats = {};
            this.currentChatId = null;
        }
    }

    // Delete chat
    deleteChat(chatId) {
        if (this.chats[chatId]) {
            delete this.chats[chatId];
            if (this.currentChatId === chatId) {
                this.currentChatId = null;
            }
            this.saveToStorage();
            return true;
        }
        return false;
    }
}

// Initialize chat manager
const chatManager = new ChatManager();

// Initialize Anti-Sycophancy Engine (will be configured after loading config)
let antiSycophancyEngine = new AntiSycophancyEngine();

// Chat history rendering functions
function renderChatHistory() {
    const chatHistoryContainer = document.getElementById('chatHistory');
    const chats = chatManager.getAllChats();
    
    if (chats.length === 0) {
        chatHistoryContainer.innerHTML = '<div class="no-chats">No chat history yet</div>';
        return;
    }
    
    let html = '<div class="history-section"><div class="history-title">Recent</div>';
    
    chats.forEach(chat => {
        const isActive = chat.id === chatManager.currentChatId ? 'active' : '';
        html += `
            <div class="chat-item ${isActive}" data-chat-id="${chat.id}">
                <span class="chat-title">${chat.title}</span>
                <button class="chat-close-btn" data-chat-id="${chat.id}" title="Delete chat">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/>
                    </svg>
                </button>
            </div>
        `;
    });
    
    html += '</div>';
    chatHistoryContainer.innerHTML = html;
    
    // Add click listeners to chat items
    attachChatItemListeners();
}

function attachChatItemListeners() {
    const chatItems = document.querySelectorAll('.chat-item');
    chatItems.forEach(item => {
        // Add click listener for chat selection (excluding close button clicks)
        item.addEventListener('click', function(e) {
            // Don't trigger chat selection if close button was clicked
            if (e.target.closest('.chat-close-btn')) {
                return;
            }
            
            const chatId = this.getAttribute('data-chat-id');
            if (chatId && chatManager.loadChat(chatId)) {
                // Update UI
                chatItems.forEach(i => i.classList.remove('active'));
                this.classList.add('active');
                
                // Render loaded chat messages
                renderChatMessages();
                
                // Update counters display
                updateCountersDisplay();
            }
        });
    });
    
    // Add click listeners for close buttons
    const closeButtons = document.querySelectorAll('.chat-close-btn');
    closeButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const chatId = this.getAttribute('data-chat-id');
            if (chatId && confirm('Are you sure you want to delete this chat?')) {
                handleChatDeletion(chatId);
            }
        });
    });
}

function handleChatDeletion(chatId) {
    const wasCurrentChat = chatManager.currentChatId === chatId;
    
    if (chatManager.deleteChat(chatId)) {
        // If we deleted the current chat, handle the transition
        if (wasCurrentChat) {
            messageHistory = [];
            clearPendingAttachments(true);
            
            // Check if any chats remain
            const remainingChats = chatManager.getAllChats();
            if (remainingChats.length === 0) {
                // No chats left, create a new one
                const newChatId = chatManager.createNewChat();
                renderChatMessages();
            } else {
                // Load the most recent remaining chat
                const mostRecent = remainingChats[0];
                chatManager.loadChat(mostRecent.id);
                renderChatMessages();
                updateCountersDisplay();
            }
        }
        
        // Re-render chat history to reflect the deletion
        // This will also reattach event listeners
        renderChatHistory();
    }
}

function createMessageElement(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${message.sender}`;
    
    if (message.sender === 'ai') {
        const badge = document.createElement('div');
        badge.className = 'personality-badge';
        badge.textContent = getPersonalityBadgeFromParameters(message.parameters || currentParameters);
        messageDiv.appendChild(badge);
        
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = formatMessage(message.content || '');
        messageDiv.appendChild(bubble);
    } else {
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = escapeUserMessageContent(message.content || '');
        messageDiv.appendChild(bubble);
    }
    
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        const attachmentsWrapper = document.createElement('div');
        attachmentsWrapper.className = 'message-attachments';
        
        message.attachments.forEach(attachment => {
            attachmentsWrapper.appendChild(createMessageAttachmentElement(attachment));
        });
        
        messageDiv.appendChild(attachmentsWrapper);
    }
    
    return messageDiv;
}

function escapeUserMessageContent(content) {
    return (content || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>');
}

function createMessageAttachmentElement(attachment) {
    const displayType = getAttachmentDisplayType(attachment);
    const wrapper = document.createElement('div');
    wrapper.className = `message-attachment ${displayType}`;
    
    if (displayType === 'image' && attachment.dataUrl) {
        const link = document.createElement('a');
        link.href = attachment.dataUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'message-attachment-link';
        link.setAttribute('aria-label', `Open image ${attachment.name} in new tab`);
        
        const image = document.createElement('img');
        image.src = attachment.dataUrl;
        image.alt = attachment.name || 'attachment image';
        link.appendChild(image);
        
        wrapper.appendChild(link);
        
        const caption = document.createElement('span');
        caption.className = 'message-attachment-name';
        caption.textContent = attachment.name || 'Image';
        wrapper.appendChild(caption);
    } else {
        const icon = document.createElement('div');
        icon.className = 'message-attachment-icon';
        icon.textContent = getAttachmentLabel(attachment.name);
        wrapper.appendChild(icon);
        
        if (attachment.dataUrl) {
            const link = document.createElement('a');
            link.href = attachment.dataUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.download = attachment.name || 'attachment';
            link.className = 'message-attachment-link';
            link.textContent = attachment.name || 'Attachment';
            wrapper.appendChild(link);
        } else {
            const nameSpan = document.createElement('span');
            nameSpan.className = 'message-attachment-name';
            nameSpan.textContent = attachment.name || 'Attachment';
            wrapper.appendChild(nameSpan);
        }
        
        const meta = document.createElement('span');
        meta.className = 'message-attachment-meta';
        meta.textContent = formatFileSize(attachment.size);
        wrapper.appendChild(meta);
    }
    
    return wrapper;
}

function getAttachmentDisplayType(attachment) {
    return isImageAttachment(attachment) ? 'image' : 'file';
}

function isImageAttachment(attachment) {
    if (!attachment) return false;
    if (attachment.displayType === 'image') return true;
    const type = (attachment.type || '').toLowerCase();
    return type.startsWith('image/');
}

function getAttachmentLabel(name) {
    const ext = getFileExtension(name);
    return ext ? ext.substring(1, Math.min(4, ext.length)).toUpperCase() : 'FILE';
}

function getFileExtension(name = '') {
    const lastDot = name.lastIndexOf('.');
    if (lastDot === -1) return '';
    return name.substring(lastDot).toLowerCase();
}

function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    const formatted = size % 1 === 0 ? size : size.toFixed(1);
    return `${formatted} ${units[unitIndex]}`;
}

function getMessagePreviewText(message) {
    if (!message) return '';
    const base = (message.content || '').trim();
    if (base) {
        return base;
    }
    
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        const names = message.attachments.map(att => att.name).filter(Boolean);
        return names.length > 0 ? `Attachments: ${names.join(', ')}` : 'Attachments';
    }
    
    return '';
}

function composeMessageContentForModel(message) {
    if (!message) {
        return [{ type: 'text', text: '' }];
    }
    
    const sections = [];
    const baseContent = typeof message.content === 'string' ? message.content.trim() : '';
    if (baseContent) {
        sections.push({ type: 'text', text: baseContent });
    }
    
    if (Array.isArray(message.attachments) && message.attachments.length > 0) {
        message.attachments.forEach(attachment => {
            const part = convertAttachmentToContentPart(attachment);
            if (part) {
                sections.push(part);
            }
        });
    }
    
    if (sections.length === 0) {
        return [{ type: 'text', text: '' }];
    }
    
    return sections;
}

function convertAttachmentToContentPart(attachment) {
    if (!attachment) {
        return null;
    }
    
    const dataUrl = attachment.dataUrl;
    if (dataUrl && isImageAttachment(attachment)) {
        return {
            type: 'image_url',
            image_url: { url: dataUrl }
        };
    }
    
    if (dataUrl) {
        return {
            type: 'file',
            file: {
                filename: attachment.name || 'attachment',
                file_data: dataUrl
            }
        };
    }
    
    const descriptorParts = [];
    if (attachment.type) descriptorParts.push(attachment.type);
    if (Number.isFinite(attachment.size)) descriptorParts.push(formatFileSize(attachment.size));
    const descriptorText = descriptorParts.length ? ` (${descriptorParts.join(', ')})` : '';
    
    return {
        type: 'text',
        text: `Attachment: ${attachment.name || 'file'}${descriptorText}`
    };
}

function convertMessageForApi(message) {
    return {
        role: message.sender === 'user' ? 'user' : 'assistant',
        content: composeMessageContentForModel(message)
    };
}

function buildPromptInput(latestUserMessage) {
    if (!latestUserMessage) {
        return '';
    }
    
    const segments = [];
    const textContent = (latestUserMessage.content || '').trim();
    if (textContent) {
        segments.push(textContent);
    }
    
    if (Array.isArray(latestUserMessage.attachments) && latestUserMessage.attachments.length > 0) {
        const lines = latestUserMessage.attachments.map(att => {
            const descriptorParts = [];
            if (att.type) descriptorParts.push(att.type);
            if (Number.isFinite(att.size)) descriptorParts.push(formatFileSize(att.size));
            if (att.source) descriptorParts.push(`source=${att.source}`);
            const descriptor = descriptorParts.length ? ` (${descriptorParts.join(', ')})` : '';
            return `- ${att.name || 'attachment'}${descriptor}`;
        });
        segments.push(`Attachments:\n${lines.join('\n')}`);
    }
    
    return segments.join('\n\n');
}

function renderChatMessages() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.innerHTML = '';
    
    if (messageHistory.length === 0) {
        chatMessages.innerHTML = `
            <div class="message ai">
                <div class="personality-badge">Direct • Confident • Formal</div>
                <div class="message-bubble">
                    Welcome to Zero. Ready when you are.
                </div>
            </div>
        `;
        return;
    }
    
    messageHistory.forEach(msg => {
        chatMessages.appendChild(createMessageElement(msg));
    });
    
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function getPersonalityBadgeFromParameters(params) {
    // Handle context-aware parameters
    if (params._context && params._contextParameters) {
        return getContextAwarePersonalityBadge(params._context, params._contextParameters[params._context]);
    }
    
    // Fallback to legacy parameter handling
    let traits = [];
    
    if (params.directness > 50) traits.push('Direct');
    else traits.push('Diplomatic');
    
    if (params.confidence > 50) traits.push('Confident');
    else traits.push('Cautious');
    
    if (params.formality > 50) traits.push('Formal');
    else traits.push('Casual');
    
    return traits.join(' • ');
}

function getContextAwarePersonalityBadge(context, contextParams) {
    let traits = [];
    
    switch (context) {
        case 'personal':
            if (contextParams.empathy > 60) traits.push('Empathetic');
            else if (contextParams.empathy < 40) traits.push('Analytical');
            
            if (contextParams.warmth > 60) traits.push('Warm');
            else if (contextParams.warmth < 40) traits.push('Professional');
            
            if (contextParams.creativity > 60) traits.push('Creative');
            else if (contextParams.creativity < 40) traits.push('Practical');
            break;
            
        case 'professional':
            if (contextParams.authority > 60) traits.push('Authoritative');
            else if (contextParams.authority < 40) traits.push('Collaborative');
            
            if (contextParams.efficiency > 60) traits.push('Efficient');
            else if (contextParams.efficiency < 40) traits.push('Thorough');
            
            if (contextParams.challenge > 60) traits.push('Challenging');
            else if (contextParams.challenge < 40) traits.push('Supportive');
            break;
            
        case 'mixed':
        default:
            if (contextParams.adaptability > 60) traits.push('Adaptable');
            else if (contextParams.adaptability < 40) traits.push('Consistent');
            
            if (contextParams.directness > 60) traits.push('Direct');
            else if (contextParams.directness < 40) traits.push('Diplomatic');
            
            if (contextParams.confidence > 60) traits.push('Confident');
            else if (contextParams.confidence < 40) traits.push('Cautious');
            break;
    }
    
    // Ensure we have at least 2-3 traits, but not more than 3
    if (traits.length === 0) {
        traits.push('Balanced', 'Thoughtful');
    } else if (traits.length > 3) {
        traits = traits.slice(0, 3);
    }
    
    return traits.join(' • ');
}

function updateCountersDisplay() {
    const disagreementElement = document.getElementById('disagreementCount');
    if (disagreementElement) {
        disagreementElement.textContent = disagreementCount;
    }
    
    const pushbackElement = document.getElementById('pushbackCount');
    if (pushbackElement) {
        pushbackElement.textContent = pushbackCount;
    }
}

// Initialize chat system
function initializeChatSystem() {
    // Render initial chat history
    renderChatHistory();
    
    // If no current chat or current chat doesn't exist, create a new one
    if (!chatManager.currentChatId || !chatManager.chats[chatManager.currentChatId]) {
        const newChatId = chatManager.createNewChat();
        renderChatHistory(); // Re-render to show the new chat
    } else {
        // Load the current chat
        chatManager.loadChat(chatManager.currentChatId);
        renderChatMessages();
        updateCountersDisplay();
    }
}

// Initialize OnboardingManager
let onboardingManager = null;

// Callback function for OnboardingManager to update parameters
function onParametersUpdateFromOnboarding(newParameters) {
    // Handle context-aware parameter updates
    if (newParameters._context) {
        // Update context
        setCurrentContext(newParameters._context);
        
        // Update context-specific parameters
        const contextParams = { ...newParameters };
        delete contextParams._context; // Remove meta property
        updateContextParameters(newParameters._context, contextParams);
    } else {
        // Fallback for legacy parameter updates
        currentParameters = { ...currentParameters, ...newParameters };
        updateLegacyParameters();
    }
    
    // Save to current chat
    chatManager.saveCurrentChat();
    
    // Update personality display
    updatePersonalityDisplay();
    
    // Update UI sliders to reflect new parameters
    chatManager.updateParameterSliders();
}


// Initialize the application
document.addEventListener('DOMContentLoaded', async function() {
    await loadConfig();
    
    // Perform parameter migration for existing data
    currentParameters = migrateToContextAware(currentParameters);
    
    initializeSliders();
    initializeChatInput();
    initializeApplyButton();
    initializeUI();
    
    // Initialize OnboardingManager
    onboardingManager = new OnboardingManager();
    onboardingManager.initialize(
        currentParameters,
        chatManager,
        onParametersUpdateFromOnboarding
    );
    
    // Initialize chat system
    initializeChatSystem();
});

// Initialize modern model selector
function initializeModelSelector() {
    const trigger = document.getElementById('modelSelectorTrigger');
    const panel = document.getElementById('modelDropdownPanel');
    const modelList = document.getElementById('modelList');
    const searchInput = document.getElementById('modelSearchInput');
    const currentProvider = document.getElementById('currentModelProvider');
    const currentName = document.getElementById('currentModelName');
    
    // Group models by provider
    const modelsByProvider = {};
    config.availableModels.forEach(model => {
        if (!modelsByProvider[model.provider]) {
            modelsByProvider[model.provider] = [];
        }
        modelsByProvider[model.provider].push(model);
    });
    
    // Render model list
    function renderModels(searchTerm = '') {
        modelList.innerHTML = '';
        
        Object.entries(modelsByProvider).forEach(([provider, models]) => {
            // Filter models based on search
            const filteredModels = models.filter(model => 
                model.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                provider.toLowerCase().includes(searchTerm.toLowerCase())
            );
            
            if (filteredModels.length === 0) return;
            
            // Create provider group
            const group = document.createElement('div');
            group.className = 'model-group';
            
            const header = document.createElement('div');
            header.className = 'model-group-header';
            header.textContent = provider;
            group.appendChild(header);
            
            // Add model options
            filteredModels.forEach(model => {
                const option = document.createElement('div');
                option.className = 'model-option';
                option.dataset.modelId = model.id;
                option.dataset.provider = provider;
                
                if (model.id === selectedModel) {
                    option.classList.add('selected');
                }
                
                option.innerHTML = `
                    <div class="model-option-info">
                        <div class="model-option-name">${model.name}</div>
                        <div class="model-option-provider">${provider}</div>
                    </div>
                `;
                
                option.addEventListener('click', () => selectModel(model, provider));
                group.appendChild(option);
            });
            
            modelList.appendChild(group);
        });
    }
    
    // Select a model
    function selectModel(model, provider) {
        selectedModel = model.id;
        currentProvider.textContent = provider;
        currentProvider.dataset.provider = provider;
        currentName.textContent = model.name;
        closeDropdown();
        
        // Update selected state
        document.querySelectorAll('.model-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.modelId === model.id);
        });
    }
    
    // Toggle dropdown
    function toggleDropdown() {
        const isOpen = panel.classList.contains('active');
        if (isOpen) {
            closeDropdown();
        } else {
            openDropdown();
        }
    }
    
    // Open dropdown
    function openDropdown() {
        trigger.classList.add('active');
        panel.classList.add('active');
        searchInput.value = '';
        renderModels();
        searchInput.focus();
    }
    
    // Close dropdown
    function closeDropdown() {
        trigger.classList.remove('active');
        panel.classList.remove('active');
    }
    
    // Event listeners
    trigger.addEventListener('click', toggleDropdown);
    
    // Search functionality
    searchInput.addEventListener('input', (e) => {
        renderModels(e.target.value);
    });
    
    // Prevent panel clicks from closing dropdown
    panel.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    
    // Close on outside click
    document.addEventListener('click', (e) => {
        if (!trigger.contains(e.target) && !panel.contains(e.target)) {
            closeDropdown();
        }
    });
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
        if (panel.classList.contains('active')) {
            if (e.key === 'Escape') {
                closeDropdown();
            }
        }
    });
    
    // Apply provider colors from config
    function applyProviderColors() {
        if (config.providerColors) {
            const style = document.createElement('style');
            let css = '';
            
            Object.entries(config.providerColors).forEach(([provider, color]) => {
                css += `.model-option[data-provider="${provider}"] .model-option-provider { color: ${color}; }\n`;
                css += `.model-provider[data-provider="${provider}"] { color: ${color}; }\n`;
            });
            
            style.textContent = css;
            document.head.appendChild(style);
        }
    }
    
    // Set initial model
    const defaultModel = config.availableModels.find(m => m.id === config.defaultModel);
    if (defaultModel) {
        currentProvider.textContent = defaultModel.provider;
        currentProvider.dataset.provider = defaultModel.provider;
        currentName.textContent = defaultModel.name;
        selectedModel = defaultModel.id;
    }
    
    // Apply provider colors
    applyProviderColors();
    
    // Initial render
    renderModels();
}

// Load configuration from config.public.json and config.private.json
async function loadConfig() {
    try {
        // Load public configuration (safe to commit to repo)
        const publicResponse = await fetch('config.public.json');
        if (!publicResponse.ok) {
            throw new Error('Failed to load config.public.json');
        }
        config = await publicResponse.json();
        
        // Try to load private configuration (contains API key)
        let privateConfig = {};
        try {
            const privateResponse = await fetch('config.private.json');
            if (privateResponse.ok) {
                privateConfig = await privateResponse.json();
            }
        } catch (privateError) {
            console.log('No private config found, will use environment variables or prompt for API key');
        }
        
        // Merge private config into main config
        config = { ...config, ...privateConfig };
        
        // Validate API key is available (should be loaded from config.private.json)
        if (!config.openRouterApiKey || config.openRouterApiKey === 'your-openrouter-api-key-here') {
            throw new Error('OpenRouter API key not found. Please check the deployment configuration.');
        }
        
        console.log('✅ OpenRouter API key loaded successfully');
        
        // Initialize modern model selector
        initializeModelSelector();
        
        // Apply color palette from config if available
        if (config.colorPalette) {
            applyColorPalette(config.colorPalette);
        }
        
        // Initialize Anti-Sycophancy Engine with config
        if (config.antiSycophancyEngine) {
            antiSycophancyEngine = new AntiSycophancyEngine(config.antiSycophancyEngine);
        }
    } catch (error) {
        console.error('Error loading config:', error);
        alert('Failed to load configuration. Please ensure config.public.json exists and config.private.json contains your OpenRouter API key.');
    }
}

// Initialize UI controls
function initializeUI() {
    const controlsToggle = document.getElementById('controlsToggle');
    const controlPanel = document.getElementById('controlPanel');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');
    const newChatBtn = document.getElementById('newChatBtn');
    const mobileReconfigureBtn = document.getElementById('mobileReconfigureBtn');
    
    // Controls panel toggle
    controlsToggle.addEventListener('click', function() {
        controlPanel.classList.toggle('open');
        document.body.classList.toggle('control-panel-open');
    });
    
    // Mobile menu toggle
    mobileMenuBtn.addEventListener('click', function() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    });
    
    // Close sidebar when clicking overlay
    overlay.addEventListener('click', function() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        controlPanel.classList.remove('open');
        document.body.classList.remove('control-panel-open');
    });
    
    // New chat functionality
    newChatBtn.addEventListener('click', function() {
        startNewChat();
    });
    
    // Mobile reconfigure button functionality
    mobileReconfigureBtn.addEventListener('click', function() {
        // Close sidebar first
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        // Open control panel
        controlPanel.classList.add('open');
        document.body.classList.add('control-panel-open');
    });
}

// Start new chat
function startNewChat() {
    // Create new chat using ChatManager
    const newChatId = chatManager.createNewChat();
    
    // Reset counters display
    updateCountersDisplay();
    
    // Render the welcome message
    renderChatMessages();
    
    // Update chat history UI
    renderChatHistory();
}

// This function is now handled by ChatManager.loadChat()

// Context-aware parameter definitions
const parameterDefinitions = {
    personal: {
        empathy: {
            name: 'Empathy',
            description: 'Emotional understanding and validation',
            tooltip: 'Controls how much your AI focuses on understanding and validating your emotions. Higher values create more emotionally supportive responses, while lower values provide more analytical, objective feedback.'
        },
        supportiveness: {
            name: 'Supportiveness',
            description: 'Encouragement vs realistic assessment',
            tooltip: 'Determines how encouraging vs realistic your AI is. Higher values provide more motivational and uplifting responses, while lower values offer more balanced, honest assessments that include potential challenges.'
        },
        creativity: {
            name: 'Creativity',
            description: 'Imaginative vs practical approaches',
            tooltip: 'Adjusts how creative and imaginative your AI\'s suggestions are. Higher values encourage out-of-the-box thinking and innovative solutions, while lower values focus on practical, proven approaches.'
        },
        warmth: {
            name: 'Warmth',
            description: 'Personal connection vs professional distance',
            tooltip: 'Controls the personal tone of communication. Higher values create a friendly, approachable personality that feels like talking to a close friend, while lower values maintain professional boundaries.'
        },
        responseLength: {
            name: 'Length of Response',
            description: 'Brief responses vs detailed explanations',
            tooltip: 'Controls the typical length of responses. Higher values provide comprehensive, detailed explanations, while lower values offer concise, to-the-point answers. Minimum is 2 lines, maximum is no limit.'
        }
    },
    professional: {
        efficiency: {
            name: 'Efficiency',
            description: 'Concise actionables vs comprehensive detail',
            tooltip: 'Controls response length and focus. Higher values provide concise, action-oriented responses that get straight to the point, while lower values offer comprehensive explanations with detailed context.'
        },
        formality: {
            name: 'Formality',
            description: 'Business communication vs casual conversation',
            tooltip: 'Adjusts the communication style from casual to formal. Higher values use professional business language and structured communication, while lower values adopt a more conversational, relaxed tone.'
        },
        challenge: {
            name: 'Challenge',
            description: 'Active questioning vs supportive agreement',
            tooltip: 'Controls how much your AI challenges your ideas and assumptions. Higher values actively question your thinking and present alternative viewpoints, while lower values are more supportive and agreeable.'
        },
        levelOfSophistication: {
            name: 'Level of Sophistication',
            description: 'Technical complexity and depth of communication',
            tooltip: 'Adjusts the complexity and technical depth of responses based on your expertise level. Higher values provide advanced, detailed technical discussions, while lower values offer simplified explanations suitable for beginners.'
        },
        responseLength: {
            name: 'Length of Response',
            description: 'Target number of lines per response',
            tooltip: 'Sets the target number of lines for responses. Value represents approximate lines (e.g., 5 = ~5 lines, 15 = ~15 lines). Minimum is 2 lines, maximum is 50 lines.'
        }
    },
    mixed: {
        creativity: {
            name: 'Creativity',
            description: 'Imaginative vs practical approaches',
            tooltip: 'Adjusts how creative and imaginative your AI\'s suggestions are. Higher values encourage out-of-the-box thinking and innovative solutions, while lower values focus on practical, proven approaches.'
        },
        directness: {
            name: 'Directness',
            description: 'Clear straightforward vs diplomatic softening',
            tooltip: 'Adjusts how directly your AI communicates difficult or sensitive information. Higher values provide clear, straightforward feedback without sugar-coating, while lower values use diplomatic language to soften the message.'
        },
        responseLength: {
            name: 'Length of Response',
            description: 'Brief responses vs detailed explanations',
            tooltip: 'Controls the typical length of responses. Higher values provide comprehensive, detailed explanations, while lower values offer concise, to-the-point answers. Minimum is 2 lines, maximum is no limit.'
        },
        adaptability: {
            name: 'Adaptability',
            description: 'Dynamic context-switching vs consistent style',
            tooltip: 'Determines how much your AI adapts its communication style based on the topic. Higher values dynamically switch between personal and professional tones as appropriate, while lower values maintain a consistent approach.'
        },
        balance: {
            name: 'Balance',
            description: 'Blended personal/professional vs single approach',
            tooltip: 'Controls how well your AI blends personal warmth with professional expertise. Higher values seamlessly combine both aspects, while lower values tend to lean more heavily toward one style or the other.'
        }
    }
};

// Dynamic parameter management
function generateDynamicParameters() {
    const context = currentParameters._context || 'mixed';
    const contextParams = getCurrentContextParameters();
    const parameterDefs = parameterDefinitions[context];
    
    const container = document.getElementById('dynamicParametersContainer');
    container.innerHTML = '';
    
    Object.keys(parameterDefs).forEach(paramKey => {
        const paramDef = parameterDefs[paramKey];
        const value = contextParams[paramKey] || 50;
        
        const parameterGroup = document.createElement('div');
        parameterGroup.className = 'parameter-group';
        parameterGroup.innerHTML = `
            <div class="parameter-label-with-tooltip">
                <div class="parameter-label">
                    <span class="parameter-name">${paramDef.name}</span>
                    <span class="parameter-value" id="${paramKey}Value">${value}</span>
                </div>
                <div class="tooltip">
                    <div class="tooltip-icon">?</div>
                    <div class="tooltip-content">${paramDef.tooltip}</div>
                </div>
            </div>
            <div class="parameter-description">
                ${paramDef.description}
            </div>
            <div class="slider-container">
                <div class="slider-track" id="${paramKey}Track" style="width: ${value}%"></div>
                <input type="range" class="slider" id="${paramKey}Slider" min="0" max="100" value="${value}">
            </div>
        `;
        
        container.appendChild(parameterGroup);
        
        // Add event listener to the slider
        const slider = document.getElementById(paramKey + 'Slider');
        const valueDisplay = document.getElementById(paramKey + 'Value');
        const track = document.getElementById(paramKey + 'Track');
        
        slider.addEventListener('input', function() {
            const newValue = parseInt(this.value);
            valueDisplay.textContent = newValue;
            track.style.width = newValue + '%';
            
            // Update context-specific parameter
            currentParameters._contextParameters[context][paramKey] = newValue;
            
            // Update legacy parameters for backward compatibility
            updateLegacyParameters();
        });
    });
}

// Initialize context selector and slider controls
function initializeSliders() {
    // Initialize context selector buttons
    initializeContextSelector();
    
    // Generate initial parameters
    generateDynamicParameters();
    
    // Update profile summary with initial state
    updateProfileSummary();
}

function initializeContextSelector() {
    const contextButtons = document.querySelectorAll('.context-btn');
    
    contextButtons.forEach(button => {
        button.addEventListener('click', function() {
            const selectedContext = this.getAttribute('data-context');
            
            // Update active state
            contextButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Switch context
            setCurrentContext(selectedContext);
            
            // Regenerate parameters for new context
            generateDynamicParameters();
            
            // Update personality display
            updatePersonalityDisplay();
        });
    });
    
    // Set initial active state based on current context
    const currentContext = currentParameters._context || 'mixed';
    const activeButton = document.querySelector(`[data-context="${currentContext}"]`);
    if (activeButton) {
        contextButtons.forEach(btn => btn.classList.remove('active'));
        activeButton.classList.add('active');
    }
}

// Initialize chat input functionality
function initializeChatInput() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    
    initializeAttachmentHandling(chatInput);
    
    // Auto-resize textarea
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });

    // Send message on button click
    sendButton.addEventListener('click', sendMessage);
    
    // Send message on Enter (but allow Shift+Enter for new lines)
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

function initializeAttachmentHandling(chatInput) {
    const attachmentButton = document.getElementById('attachmentButton');
    const attachmentInput = document.getElementById('attachmentInput');
    
    if (!attachmentButton || !attachmentInput || !chatInput) {
        return;
    }
    
    attachmentButton.addEventListener('click', () => {
        attachmentInput.click();
    });
    
    attachmentInput.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (files.length > 0) {
            await handleAttachmentSelection(files, 'upload');
            attachmentInput.value = '';
        }
    });
    
    chatInput.addEventListener('paste', async (event) => {
        const clipboardItems = event.clipboardData && event.clipboardData.items;
        if (!clipboardItems || clipboardItems.length === 0) {
            return;
        }
        
        const files = [];
        let index = 0;
        for (const item of clipboardItems) {
            if (item.kind !== 'file') continue;
            const blob = item.getAsFile();
            if (!blob) continue;
            
            const type = (blob.type || '').toLowerCase();
            if (!type.startsWith('image/')) {
                // Only support pasting images for now
                continue;
            }
            
            const extension = type.split('/')[1] || 'png';
            const fallbackName = `clipboard-${Date.now()}-${index}.${extension}`;
            const fileName = blob.name && blob.name.trim().length > 0 ? blob.name : fallbackName;
            const file = new File([blob], fileName, { type: blob.type || `image/${extension}` });
            files.push(file);
            index++;
        }
        
        if (files.length === 0) {
            return;
        }
        
        // Prevent default only when no text payload is present to avoid losing pasted text
        const hasTextPayload = event.clipboardData.getData('text');
        if (!hasTextPayload) {
            event.preventDefault();
        }
        
        await handleAttachmentSelection(files, 'clipboard');
    });
    
    renderAttachmentPreviews();
}

async function handleAttachmentSelection(files, source) {
    if (!files || files.length === 0) return;
    
    let addedCount = 0;
    let hadError = false;
    let hadWarning = false;
    for (const file of files) {
        if (!(file instanceof File)) continue;
        
        if (pendingAttachments.length >= ATTACHMENT_LIMIT) {
            showAttachmentFeedback(`You can attach up to ${ATTACHMENT_LIMIT} items per message.`, 'warning');
            hadWarning = true;
            break;
        }
        
        if (!isFileTypeAllowed(file)) {
            showAttachmentFeedback(`"${file.name || 'File'}" is not a supported file type for this demo.`, 'error');
            hadError = true;
            continue;
        }
        
        if (file.size > ATTACHMENT_SIZE_LIMIT) {
            const limitMb = Math.round(ATTACHMENT_SIZE_LIMIT / (1024 * 1024));
            showAttachmentFeedback(`"${file.name}" is larger than the ${limitMb}MB limit for demo attachments.`, 'error');
            hadError = true;
            continue;
        }
        
        try {
            const dataUrl = await readFileAsDataURL(file);
            const normalizedType = file.type || inferMimeTypeFromExtension(file.name);
            const displayType = normalizedType && normalizedType.startsWith('image/') ? 'image' : 'file';
            
            pendingAttachments.push({
                id: generateAttachmentId(),
                name: file.name || 'attachment',
                type: normalizedType,
                size: file.size,
                source,
                dataUrl,
                displayType
            });
            addedCount++;
        } catch (error) {
            console.error('Failed to process attachment', error);
            showAttachmentFeedback(`Could not add "${file.name || 'attachment'}". Please try again.`, 'error');
            hadError = true;
        }
    }
    
    if (addedCount > 0 && !hadError && !hadWarning) {
        clearAttachmentFeedback();
    }
    
    renderAttachmentPreviews();
}

function generateAttachmentId() {
    return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isFileTypeAllowed(file) {
    const type = (file.type || '').toLowerCase();
    const extension = getFileExtension(file.name);
    
    if (type.startsWith('image/')) {
        return true;
    }
    
    const typeAllowed = type && ALLOWED_ATTACHMENT_TYPES.includes(type);
    const extensionAllowed = extension && ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension);
    
    return typeAllowed || extensionAllowed;
}

function inferMimeTypeFromExtension(name) {
    const extension = getFileExtension(name);
    switch (extension) {
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        case '.webp':
            return 'image/webp';
        case '.svg':
            return 'image/svg+xml';
        case '.pdf':
            return 'application/pdf';
        case '.txt':
            return 'text/plain';
        case '.md':
            return 'text/markdown';
        case '.json':
            return 'application/json';
        case '.csv':
            return 'text/csv';
        case '.doc':
            return 'application/msword';
        case '.docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        case '.xls':
            return 'application/vnd.ms-excel';
        case '.xlsx':
            return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case '.ppt':
            return 'application/vnd.ms-powerpoint';
        case '.pptx':
            return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        default:
            return '';
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderAttachmentPreviews() {
    const previewContainer = document.getElementById('attachmentPreview');
    if (!previewContainer) return;
    
    previewContainer.innerHTML = '';
    
    pendingAttachments.forEach(attachment => {
        const item = document.createElement('div');
        const type = attachment.displayType || getAttachmentDisplayType(attachment);
        item.className = `attachment-item ${type}`;
        item.title = `${attachment.name} • ${formatFileSize(attachment.size)} • ${getAttachmentSourceLabel(attachment.source)}`;
        
        const thumb = document.createElement('div');
        thumb.className = 'attachment-thumb';
        
        if (type === 'image' && attachment.dataUrl) {
            const image = document.createElement('img');
            image.src = attachment.dataUrl;
            image.alt = attachment.name;
            thumb.appendChild(image);
        } else {
            thumb.textContent = getAttachmentLabel(attachment.name);
        }
        
        const meta = document.createElement('div');
        meta.className = 'attachment-meta';
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'attachment-name';
        nameSpan.textContent = attachment.name;
        
        const sizeSpan = document.createElement('span');
        sizeSpan.className = 'attachment-size';
        sizeSpan.textContent = `${formatFileSize(attachment.size)} • ${getAttachmentSourceLabel(attachment.source)}`;
        
        meta.appendChild(nameSpan);
        meta.appendChild(sizeSpan);
        
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'attachment-remove';
        removeButton.setAttribute('aria-label', `Remove ${attachment.name}`);
        removeButton.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.3 5.71L12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.18 12 2.89 5.71 4.3 4.29 10.59 10.6l6.29-6.31z"/>
            </svg>
        `;
        removeButton.addEventListener('click', () => removePendingAttachment(attachment.id));
        
        item.appendChild(thumb);
        item.appendChild(meta);
        item.appendChild(removeButton);
        
        previewContainer.appendChild(item);
    });
}

function removePendingAttachment(id) {
    pendingAttachments = pendingAttachments.filter(att => att.id !== id);
    renderAttachmentPreviews();
    
    if (pendingAttachments.length === 0) {
        clearAttachmentFeedback();
    }
}

function clearPendingAttachments(resetFeedback = false) {
    pendingAttachments = [];
    renderAttachmentPreviews();
    if (resetFeedback) {
        clearAttachmentFeedback();
    }
}

function showAttachmentFeedback(message, tone = 'info') {
    const feedback = document.getElementById('attachmentFeedback');
    if (!feedback) return;
    
    feedback.textContent = message;
    feedback.classList.remove('error', 'warning');
    
    if (tone === 'error') {
        feedback.classList.add('error');
    } else if (tone === 'warning') {
        feedback.classList.add('warning');
    }
}

function clearAttachmentFeedback() {
    const feedback = document.getElementById('attachmentFeedback');
    if (!feedback) return;
    feedback.textContent = '';
    feedback.classList.remove('error', 'warning');
}

function getAttachmentSourceLabel(source) {
    return source === 'clipboard' ? 'Clipboard' : 'Upload';
}

// Initialize apply button
function initializeApplyButton() {
    const applyButton = document.getElementById('applyButton');
    
    applyButton.addEventListener('click', function() {
        const controlPanel = document.getElementById('controlPanel');
        
        // Visual feedback
        this.textContent = 'Applied!';
        this.classList.add('applied');
        
        // Update personality badge in real-time
        updatePersonalityDisplay();
        
        // Save current parameters to chat
        chatManager.saveCurrentChat();
        
        setTimeout(() => {
            this.textContent = 'Apply Changes';
            this.classList.remove('applied');
            
            // Hide the control panel with smooth animation
            controlPanel.classList.remove('open');
            // Also remove the body class to show hamburger menu
            document.body.classList.remove('control-panel-open');
        }, 800);
    });
}

// Send message function
function sendMessage() {
    const chatInput = document.getElementById('chatInput');
    const message = chatInput.value.trim();
    const attachmentsForMessage = pendingAttachments.map(att => ({ ...att }));
    
    if (!message && attachmentsForMessage.length === 0) {
        return;
    }
    
    // Add user message to chat
    addMessageToChat('user', message, attachmentsForMessage);
    
    const latestMessage = messageHistory[messageHistory.length - 1];
    
    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';
    clearPendingAttachments(true);
    
    // Show typing indicator
    showTypingIndicator();
    
    // Generate AI response
    generateAIResponse(latestMessage).then(() => {
        hideTypingIndicator();
    }).catch(() => {
        hideTypingIndicator();
    });
}

// Format message content with markdown support
function formatMessage(content) {
    // Configure marked options
    marked.setOptions({
        breaks: true, // Preserve line breaks
        gfm: true, // GitHub Flavored Markdown
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {}
            }
            return hljs.highlightAuto(code).value;
        },
        headerIds: false,
        mangle: false
    });
    
    // Parse markdown to HTML
    const formattedContent = marked.parse(content);
    
    return formattedContent;
}

// Add message to chat display
function addMessageToChat(sender, content, attachments = []) {
    const chatMessages = document.getElementById('chatMessages');
    const normalizedAttachments = Array.isArray(attachments)
        ? attachments.map(att => ({ ...att }))
        : [];
    
    const messageData = { 
        sender, 
        content, 
        attachments: normalizedAttachments,
        parameters: {...currentParameters},
        timestamp: Date.now()
    };
    
    chatMessages.appendChild(createMessageElement(messageData));
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    messageHistory.push(messageData);
    
    // Auto-save chat after adding message
    chatManager.saveCurrentChat();
    
    // Update chat history UI to reflect any title changes
    if (sender === 'user') {
        renderChatHistory();
    }
}

// Generate AI response based on current parameters
async function generateAIResponse(latestUserMessage) {
    if (!config || !config.openRouterApiKey || config.openRouterApiKey === 'your-openrouter-api-key-here') {
        addMessageToChat('ai', 'Please configure your OpenRouter API key in config.json to use the chat functionality.');
        return;
    }
    
    try {
        // Build the system prompt using Anti-Sycophancy Engine
        let systemPrompt;
        try {
            const promptInput = buildPromptInput(latestUserMessage);
            systemPrompt = antiSycophancyEngine.generateSystemPrompt(
                promptInput, 
                messageHistory, 
                currentParameters
            );
            
            // Debug logging if enabled
            if (config.debug) {
                console.log('=== SYSTEM PROMPT DEBUG ===');
                console.log('User Message:', buildPromptInput(latestUserMessage));
                console.log('Current Parameters:', currentParameters);
                console.log('Generated System Prompt:');
                console.log(systemPrompt);
                console.log('========================');
            }
        } catch (engineError) {
            console.error('AntiSycophancyEngine error:', engineError);
            // Fallback to basic system prompt
            systemPrompt = "You are an AI assistant designed to provide authentic, non-sycophantic responses.";
            
            if (config.debug) {
                console.log('=== FALLBACK SYSTEM PROMPT ===');
                console.log(systemPrompt);
                console.log('============================');
            }
        }
        
        // Prepare request payload
        const conversationMessages = messageHistory.map(msg => convertMessageForApi(msg));

        const requestPayload = {
            model: selectedModel,
            messages: [
                { role: 'system', content: systemPrompt },
                ...conversationMessages
            ],
            temperature: config.temperature || 0.7,
            max_tokens: config.maxTokens || 4096
        };

        // Log request details if debug is enabled
        if (config.debug) {
            console.log('=== OPENROUTER API REQUEST ===');
            console.log('Endpoint:', config.apiEndpoint);
            console.log('Model:', selectedModel);
            console.log('Messages count:', requestPayload.messages.length);
            console.log('Temperature:', requestPayload.temperature);
            console.log('Max tokens:', requestPayload.max_tokens);
            console.log('=============================');
        }

        // Call OpenRouter API
        const response = await fetch(config.apiEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.openRouterApiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': window.location.href,
                'X-Title': 'Zero AI'
            },
            body: JSON.stringify(requestPayload)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('OpenRouter API Error Details:', {
                status: response.status,
                statusText: response.statusText,
                url: config.apiEndpoint,
                model: selectedModel,
                error: errorData
            });
            throw new Error(`API Error ${response.status}: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if response has expected structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('Unexpected API response structure:', data);
            throw new Error('Invalid response structure from API');
        }
        
        const aiMessage = data.choices[0].message;
        let aiResponse = aiMessage.content;
        if (Array.isArray(aiResponse)) {
            aiResponse = aiResponse.map(part => {
                if (typeof part === 'string') return part;
                if (part?.text) return part.text;
                if (part?.type === 'output_text' && part?.output_text?.content) {
                    return part.output_text.content;
                }
                return '';
            }).join('\n').trim();
        }
        
        // Apply anti-sycophancy engine logic
        const context = antiSycophancyEngine.analyzeConversationContext(
            buildPromptInput(latestUserMessage),
            messageHistory
        );
        if (context.shouldChallenge) {
            if (context.preferredChallengeType === 'devils_advocate' || 
                context.preferredChallengeType === 'perspective_shift') {
                disagreementCount++;
                const disagreementElement = document.getElementById('disagreementCount');
                if (disagreementElement) {
                    disagreementElement.textContent = disagreementCount;
                }
            }
            
            if (context.preferredChallengeType === 'socratic' || 
                context.preferredChallengeType === 'evidence_challenge') {
                pushbackCount++;
                const pushbackElement = document.getElementById('pushbackCount');
                if (pushbackElement) {
                    pushbackElement.textContent = pushbackCount;
                }
            }
        }
        
        addMessageToChat('ai', aiResponse);
    } catch (error) {
        console.error('Error calling OpenRouter API:', error);
        addMessageToChat('ai', 'Sorry, I encountered an error while processing your request. Please check your API configuration and try again.');
    }
}

// System prompt generation is now handled by the AntiSycophancyEngine
// The old buildSystemPrompt function has been replaced with advanced dynamic prompting

// Anti-sycophancy engine logic is now handled by the AntiSycophancyEngine class
// These functions have been replaced with sophisticated conversation analysis and contextual prompting

// Get personality badge text using current context-aware parameters
function getPersonalityBadge() {
    return getPersonalityBadgeFromParameters(currentParameters);
}

// Update personality display
function updatePersonalityDisplay() {
    // Update the profile summary display
    updateProfileSummary();
    
    // This would trigger an update to show the new personality in the next message
    console.log('Personality updated:', currentParameters);
}

// Update the Active Profile Summary
function updateProfileSummary() {
    // Check if onboarding was completed and get the selected context
    const onboardStatus = onboardingManager ? onboardingManager.getOnboardCompletionStatus() : null;
    const context = onboardStatus && onboardStatus.selectedContext ? onboardStatus.selectedContext : (currentParameters._context || 'mixed');
    
    // Update context display
    const contextDisplay = document.getElementById('currentContext');
    if (contextDisplay) {
        const contextLabels = {
            'personal': 'Personal Use',
            'professional': 'Professional Use', 
            'mixed': 'Mixed Use'
        };
        contextDisplay.textContent = contextLabels[context] || 'Mixed Use';
    }
}

// Generate current personality traits based on context and parameters
function generateCurrentTraits(context, contextParams) {
    let traits = [];
    
    switch (context) {
        case 'personal':
            if (contextParams.empathy > 70) traits.push('Empathetic');
            else if (contextParams.empathy < 40) traits.push('Analytical');
            
            if (contextParams.warmth > 70) traits.push('Warm');
            else if (contextParams.warmth < 40) traits.push('Professional');
            
            if (contextParams.creativity > 70) traits.push('Creative'); 
            else if (contextParams.creativity < 40) traits.push('Practical');
            
            if (contextParams.supportiveness > 70) traits.push('Encouraging');
            break;
            
        case 'professional':
            if (contextParams.authority > 70) traits.push('Authoritative');
            else if (contextParams.authority < 40) traits.push('Collaborative');
            
            if (contextParams.efficiency > 70) traits.push('Efficient');
            else if (contextParams.efficiency < 40) traits.push('Thorough');
            
            if (contextParams.formality > 70) traits.push('Formal');
            else if (contextParams.formality < 40) traits.push('Casual');
            
            if (contextParams.challenge > 70) traits.push('Challenging');
            break;
            
        case 'mixed':
        default:
            if (contextParams.adaptability > 70) traits.push('Adaptable');
            else if (contextParams.adaptability < 40) traits.push('Consistent');
            
            if (contextParams.directness > 70) traits.push('Direct');
            else if (contextParams.directness < 40) traits.push('Diplomatic');
            
            if (contextParams.confidence > 70) traits.push('Confident');
            else if (contextParams.confidence < 40) traits.push('Cautious'); 
            
            if (contextParams.balance > 70) traits.push('Balanced');
            break;
    }
    
    // Ensure we have 2-3 traits
    if (traits.length === 0) {
        traits = ['Balanced', 'Thoughtful'];
    } else if (traits.length > 3) {
        traits = traits.slice(0, 3);
    } else if (traits.length === 1) {
        traits.push('Thoughtful');
    }
    
    return traits;
}

// Generate profile description based on context and parameters
function generateProfileDescription(context, contextParams) {
    const descriptions = {
        'personal': "Your AI provides personalized support with emotional understanding and creative insight.",
        'professional': "Your AI offers expert guidance with structured, business-focused communication.",
        'mixed': "Your AI adapts its communication style based on context while maintaining consistency."
    };
    
    // Basic description based on context
    let description = descriptions[context] || descriptions['mixed'];
    
    // Add context-specific nuances based on parameter levels
    switch (context) {
        case 'personal':
            if (contextParams.empathy > 70 && contextParams.warmth > 70) {
                description = "Your AI provides deeply empathetic support with genuine warmth and personal connection.";
            } else if (contextParams.creativity > 70 && contextParams.supportiveness > 70) {
                description = "Your AI combines creative thinking with strong encouragement to help you explore possibilities.";
            }
            break;
            
        case 'professional':
            if (contextParams.authority > 70 && contextParams.efficiency > 70) {
                description = "Your AI delivers expert recommendations with focused, actionable insights.";
            } else if (contextParams.challenge > 70 && contextParams.formality > 70) {
                description = "Your AI provides structured analysis while actively questioning assumptions.";
            }
            break;
            
        case 'mixed':
            if (contextParams.adaptability > 70 && contextParams.balance > 70) {
                description = "Your AI seamlessly transitions between personal warmth and professional expertise as needed.";
            } else if (contextParams.directness > 70 && contextParams.confidence > 70) {
                description = "Your AI communicates with clear confidence and straightforward honesty across all contexts.";
            }
            break;
    }
    
    return description;
}

// Typing indicator functions
function showTypingIndicator() {
    const chatMessages = document.getElementById('chatMessages');
    const typingDiv = document.createElement('div');
    typingDiv.id = 'typingIndicator';
    typingDiv.className = 'message ai';
    typingDiv.innerHTML = `
        <div class="typing-indicator">
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;
    
    chatMessages.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function hideTypingIndicator() {
    const typingIndicator = document.getElementById('typingIndicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
}

// Apply color palette from config to CSS custom properties
function applyColorPalette(colorPalette) {
    const root = document.documentElement;
    
    // Set CSS custom properties for dynamic color theming
    root.style.setProperty('--primary-color', colorPalette.primary || '#284B63');
    root.style.setProperty('--primary-variant-color', colorPalette.primaryVariant || '#3700B3');
    root.style.setProperty('--secondary-color', colorPalette.secondary || '#03DAC6');
    root.style.setProperty('--background-color', colorPalette.background || '#121212');
    root.style.setProperty('--surface-color', colorPalette.surface || '#121212');
    root.style.setProperty('--error-color', colorPalette.error || '#CF6679');
    root.style.setProperty('--on-primary-color', colorPalette.onPrimary || '#000000');
    root.style.setProperty('--on-secondary-color', colorPalette.onSecondary || '#000000');
    root.style.setProperty('--on-background-color', colorPalette.onBackground || '#FFFFFF');
    root.style.setProperty('--on-surface-color', colorPalette.onSurface || '#FFFFFF');
    root.style.setProperty('--on-error-color', colorPalette.onError || '#000000');
    
    console.log('Applied color palette from config:', colorPalette);
}
