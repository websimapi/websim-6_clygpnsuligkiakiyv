// DO NOT CHANGE UNLESS USER ASKS YOU TO
const API_URL = "https://tproxy.val.run/image";
// You can change stuff under this.
const promptInput = document.getElementById('promptInput');
const generateBtn = document.getElementById('generateBtn');
const feedContainer = document.getElementById('feedContainer');
const emptyState = document.getElementById('emptyState');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const likePopup = document.getElementById('likePopup');
const closeLikePopup = document.getElementById('closeLikePopup');

// Share Sheet Elements
const shareSheetOverlay = document.getElementById('shareSheetOverlay');
const sharePreviewImg = document.getElementById('sharePreviewImg');
const sharePreviewText = document.getElementById('sharePreviewText');
const shareOptionComment = document.getElementById('shareOptionComment');
const shareOptionMore = document.getElementById('shareOptionMore');
const shareCancelBtn = document.getElementById('shareCancelBtn');

let currentShareMsg = null;
let currentShareFile = null;

const room = new WebsimSocket();
let renderedMsgIds = new Set();
const MAX_VISIBLE_MESSAGES = 100;

// Show like popup on load
window.addEventListener('load', () => {
    setTimeout(() => {
        if(likePopup) likePopup.classList.add('visible');
    }, 800);
});

if (closeLikePopup && likePopup) {
    closeLikePopup.addEventListener('click', () => {
        likePopup.classList.remove('visible');
    });
}

// Share Sheet Logic
function openShareSheet(msg) {
    currentShareMsg = msg;
    sharePreviewImg.src = msg.imageUrl;
    sharePreviewText.textContent = msg.prompt;
    shareSheetOverlay.classList.add('visible');

    // Reset and start pre-fetching for "More" option to ensure iOS compatibility
    currentShareFile = null;
    fetch(msg.imageUrl)
        .then(res => res.blob())
        .then(blob => {
            // Only update if the user hasn't closed/switched messages
            if (currentShareMsg === msg) {
                currentShareFile = new File([blob], `dream-${Date.now()}.png`, { type: "image/png" });
            }
        })
        .catch(console.error);
}

function closeShareSheet() {
    shareSheetOverlay.classList.remove('visible');
    // Clear after animation
    setTimeout(() => {
        currentShareMsg = null;
        currentShareFile = null;
    }, 300);
}

shareCancelBtn.addEventListener('click', closeShareSheet);
shareSheetOverlay.addEventListener('click', (e) => {
    if (e.target === shareSheetOverlay) closeShareSheet();
});

shareOptionComment.addEventListener('click', async () => {
    if (!currentShareMsg) return;
    const msg = currentShareMsg;
    closeShareSheet(); // Close UI immediately
    
    showToast("Preparing comment...");

    try {
        let file = currentShareFile;
        
        // If not pre-fetched yet, fetch now
        if (!file) {
            const response = await fetch(msg.imageUrl);
            const blob = await response.blob();
            file = new File([blob], "generated-image.png", { type: "image/png" });
        }
        
        // Upload to websim for native embedding
        const uploadedUrl = await window.websim.upload(file);
        
        // Post comment
        await window.websim.postComment({
            content: `Re: "${msg.prompt}"`, // Short context
            images: [uploadedUrl]
        });
        
    } catch (error) {
        console.error("Comment share failed:", error);
        showToast("Failed to share to comments.");
    }
});

shareOptionMore.addEventListener('click', async () => {
    if (!currentShareMsg) return;
    const msg = currentShareMsg;
    closeShareSheet();

    try {
        if (!navigator.share) {
            // Fallback for browsers without Web Share API (Desktop mostly)
            await navigator.clipboard.writeText(msg.imageUrl);
            showToast("Link copied to clipboard");
            return;
        }

        let fileToShare = currentShareFile;

        // If not pre-fetched yet, try to fetch now (might risk gesture loss on strict iOS, but necessary)
        if (!fileToShare) {
            try {
                const response = await fetch(msg.imageUrl);
                const blob = await response.blob();
                fileToShare = new File([blob], `dream-${Date.now()}.png`, { type: "image/png" });
            } catch (e) {
                console.warn("Fetch for share failed", e);
            }
        }

        let shared = false;

        // Strategy 1: Share File
        // iOS requires sharing files WITHOUT text/url mixed in for best compatibility
        if (fileToShare) {
            try {
                const shareData = {
                    files: [fileToShare]
                };
                if (navigator.canShare && navigator.canShare(shareData)) {
                    await navigator.share(shareData);
                    shared = true;
                }
            } catch (err) {
                console.warn("File share failed, falling back to URL", err);
            }
        }

        // Strategy 2: Share URL (Fallback)
        if (!shared) {
            await navigator.share({
                url: msg.imageUrl
            });
        }
    } catch (error) {
        console.warn("Share failed:", error);
        // Only show error toast if it wasn't a user cancellation
        if (error.name !== 'AbortError' && !error.message.toLowerCase().includes('cancel')) {
            showToast("Share failed");
        }
    }
});

async function initRoom() {
    await room.initialize();
    
    // Initialize presence
    room.updatePresence({ isGenerating: false });

    room.collection('image_logs').subscribe((messages) => {
        updateFeed(messages);
    });

    // Manual polling every 10s as requested to ensure updates
    setInterval(async () => {
        try {
            const messages = await room.collection('image_logs').getList();
            updateFeed(messages);
        } catch (e) {
            // fail silently
        }
    }, 10000);
}

// Initialize room
initRoom();

function updateFeed(messages) {
    if (!messages) return;

    // Optimization: Identify new messages first
    const msgList = Array.isArray(messages) ? messages : Object.values(messages);
    const newMessages = [];
    for (const msg of msgList) {
        if (!renderedMsgIds.has(msg.id)) {
            newMessages.push(msg);
        }
    }

    if (newMessages.length === 0) return;

    if (emptyState) {
        emptyState.style.display = 'none';
    }

    // Sort new messages: Newest First
    newMessages.sort((a, b) => {
        const timeA = new Date(a.created_at || a.timestamp).getTime();
        const timeB = new Date(b.created_at || b.timestamp).getTime();
        return timeB - timeA; // Descending (Newest first)
    });

    // Disable animation for large batches (initial load) to reduce lag
    const enableAnimation = newMessages.length < 5;

    // Use DocumentFragment for batch DOM insertion
    const fragment = document.createDocumentFragment();
    newMessages.forEach(msg => {
        const card = createMessageCard(msg, enableAnimation);
        fragment.appendChild(card);
        renderedMsgIds.add(msg.id);
    });

    // Insert at the TOP of the feed
    feedContainer.prepend(fragment);

    // DOM Pruning: Remove old messages (now at the bottom) to keep memory usage low
    const cards = feedContainer.querySelectorAll('.message-card');
    if (cards.length > MAX_VISIBLE_MESSAGES) {
        const toRemove = cards.length - MAX_VISIBLE_MESSAGES;
        // Remove from the end (bottom of the list)
        for (let i = cards.length - 1; i >= cards.length - toRemove; i--) {
            cards[i].remove();
        }
    }
}

function createMessageCard(msg, animate = true) {
    const card = document.createElement('div');
    card.className = 'message-card';
    if (!animate) {
        card.style.animation = 'none';
    }
    
    // Format time
    const timestamp = new Date(msg.created_at || msg.timestamp);
    const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const avatarUrl = msg.avatarUrl || `https://images.websim.com/avatar/${msg.username}`;

    card.innerHTML = `
        <div class="message-header">
            <img src="${avatarUrl}" class="user-avatar" alt="User">
            <span class="user-name">${escapeHtml(msg.username)}</span>
            <span class="timestamp">${timeStr}</span>
        </div>
        <div class="message-prompt">${escapeHtml(msg.prompt)}</div>
        <img src="${msg.imageUrl}" class="generated-image" loading="lazy">
        <div class="message-footer">
            <div class="execution-tag">Generated in ${msg.elapsed}s</div>
            <button class="share-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                Share
            </button>
        </div>
    `;

    const shareBtn = card.querySelector('.share-btn');
    shareBtn.addEventListener('click', () => {
        openShareSheet(msg);
    });

    return card;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Auto-resize textarea
promptInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.value === '') {
        this.style.height = 'auto';
    }
});

generateBtn.addEventListener('click', generateImage);

// Handle Enter key (without shift) to submit
promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        generateImage();
    }
});

async function generateImage() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    // Check global limit (max 2 concurrent generations)
    const activeGenerations = Object.values(room.presence).filter(p => p && p.isGenerating).length;
    if (activeGenerations >= 2) {
        showToast("System busy: Only 2 images can be generated at a time globally.");
        return;
    }

    // UI State: Loading
    setLoading(true);
    const startTime = Date.now();
    room.updatePresence({ isGenerating: true });
    promptInput.disabled = true;
    generateBtn.disabled = true;
    
    // Random loading messages to keep it interesting
    const messages = ["Dreaming...", "Mixing colors...", "Applying style...", "Rendering pixels..."];
    let msgInterval = setInterval(() => {
        loadingText.textContent = messages[Math.floor(Math.random() * messages.length)];
    }, 2000);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        // Extract image data
        const contentType = response.headers.get('content-type');
        let imageUrl = null;
        let elapsed = '0';
        
        if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            
            // Check for the specific proxy format: { result: "https://..." }
            if (data.result) {
                imageUrl = data.result;
            } else {
                // Fallback attempt
                const res = extractDataFromJson(data);
                if (res) imageUrl = res.url;
            }
            
            // Calculate elapsed time manually since proxy doesn't send metadata
            elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        } else {
            // Blob fallback (In case proxy changes back to binary)
            const blob = await response.blob();
            const file = new File([blob], "image.png", { type: "image/png" });
            imageUrl = await websim.upload(file);
            elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        }

        if (imageUrl) {
            // Persist to DB
            await room.collection('image_logs').create({
                prompt: prompt,
                imageUrl: imageUrl,
                elapsed: elapsed
            });
            
            promptInput.value = '';
            promptInput.style.height = 'auto';
        } else {
            throw new Error("Could not parse image URL from response");
        }

    } catch (error) {
        console.error("Generation failed:", error);
        showToast("Failed to generate image. " + error.message);
    } finally {
        room.updatePresence({ isGenerating: false });
        clearInterval(msgInterval);
        setLoading(false);
        promptInput.disabled = false;
        generateBtn.disabled = false;
        promptInput.focus();
    }
}

function extractDataFromJson(data) {
    let url = null;

    if (data.images && Array.isArray(data.images) && data.images.length > 0) {
        url = data.images[0].url;
    } else if (data.url) {
        url = data.url;
    } else if (data.image) {
        if (data.image.startsWith('http')) {
            url = data.image;
        }
    } else if (data.output && data.output[0]) {
        url = data.output[0];
    }
    
    return url ? { url } : null;
}

function setLoading(isLoading) {
    if (isLoading) {
        loadingOverlay.classList.add('active');
    } else {
        loadingOverlay.classList.remove('active');
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger reflow
    toast.offsetHeight;
    
    toast.classList.add('visible');
    
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}