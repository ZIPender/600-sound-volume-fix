window.prevSoundVolume = null;
window.localSoundVolume = 100;

const HOSTS_TO_IGNORE = [
    'cdn.videofarm.daum.net',
    'computerbase.de',
    'production.assets.clips.twitchcdn.net'
];

// Hosts that require fallback due to CORS/DRM restrictions
const HOSTS_REQUIRING_FALLBACK = [
    'reddit.com',
    'www.reddit.com',
    'old.reddit.com',
    'netflix.com',
    'www.netflix.com',
    'hulu.com',
    'www.hulu.com',
    'disneyplus.com',
    'www.disneyplus.com',
    'amazon.com',
    'www.amazon.com',
    'primevideo.com',
    'www.primevideo.com',
    'hbomax.com',
    'www.hbomax.com',
    'max.com',
    'www.max.com',
    'spotify.com',
    'open.spotify.com'
];

function _browser() {
    if (typeof browser !== 'undefined') {
        return browser;
    } else {
        return chrome;
    }
}

// Load saved volume from storage on startup
function loadSavedVolume() {
    _browser().storage.local.get({savedVolume: 100}, (result) => {
        if (result && result.savedVolume !== undefined) {
            window.localSoundVolume = Number(result.savedVolume);
        }
    });
}

// Save volume to storage
function saveVolume(volume) {
    _browser().storage.local.set({savedVolume: volume});
}

// Check if current host requires fallback (CORS/DRM issues)
function hostRequiresFallback(url) {
    if (!url) {
        return false;
    }
    try {
        const hostname = new URL(url).hostname;
        for (let i = 0; i < HOSTS_REQUIRING_FALLBACK.length; i++) {
            if (hostname === HOSTS_REQUIRING_FALLBACK[i] || hostname.endsWith('.' + HOSTS_REQUIRING_FALLBACK[i])) {
                return true;
            }
        }
    } catch (e) {
        // Invalid URL, assume fallback is not required
        return false;
    }
    return false;
}

// Load saved volume on script initialization
loadSavedVolume();

function hostToIgnore(url) {
    if (!url) {
        return false;
    }
    for (let i = 0; i < HOSTS_TO_IGNORE.length; i++) {
        if (url.indexOf(HOSTS_TO_IGNORE[i]) > -1) {
            return true;
        }
    }
    return false;
}

function sendToBackground(action, onResponse) {
    const data = {};
    data.soundVolume = localSoundVolume;
    try {
        _browser().runtime.sendMessage({'action': action, data: data},
            response => {
                let err = _browser().runtime.lastError;
                if (err && !err) {
                    console.warn(err);
                }
                if (onResponse) {
                    onResponse(response);
                }
            });
    } catch (e) {
        window.console.warn(e);
    }
}

function isMediaActive(media) {
    for (let i = 0; i < media.length; i++) {
        const target = media[i];
        if (!target.paused) {
            return true;
        }
    }
    return false;
}

function changeSoundVolume(document) {
    const media = [...document.querySelectorAll('video, audio')];
    if (window.localSoundVolume === window.prevSoundVolume || !isMediaActive(media)) {
        return;
    }

    window.prevSoundVolume = window.localSoundVolume;
    
    // Save the volume to storage for persistence
    saveVolume(window.localSoundVolume);

    sendToBackground('changeSoundVolume');

    // Check if this site has CORS/DRM restrictions that prevent Web Audio API
    const useFallback = hostRequiresFallback(window.location.href);
    
    // In Chrome (when browser is undefined), the background script handles volume via tab capture
    if (typeof browser === 'undefined') {
        return;
    }
    
    // Skip Web Audio approach for sites that require fallback (let background handle it)
    if (useFallback) {
        return;
    }

    for (let i = 0; i < media.length; i++) {
        const target = media[i];
        let src = target.src || target.currentSrc;
        if (src && !hostToIgnore(src)) {
            if (!target.audiocontext) {
                try {
                    if (target.crossOrigin !== 'anonymous') {
                        target.setAttribute('crossorigin', 'anonymous');
                        target.crossOrigin = 'anonymous';
                        if (src && src.indexOf('https://') === -1 && location.href && location.href.indexOf('https://') === 0) {
                            src = src.replace('http://', 'https://');
                        }
                        if (src.substring(0, 5) !== "blob:") {
                            const play = !target.paused;
                            target.src = src + '';
                            if (play) {
                                target.play().catch(() => {});
                            }
                        }
                    }
                    target.audiocontext = new AudioContext();
                    target.creategain = target.audiocontext.createGain();
                    target.source = target.audiocontext.createMediaElementSource(target);
                    target.source.connect(target.creategain);
                    target.creategain.connect(target.audiocontext.destination);
                } catch (e) {
                    // If Web Audio API fails (e.g., due to CORS/DRM), skip this element
                    // The background script's tab capture will handle audio for the whole tab
                    target.audioContextFailed = true;
                    window.console.warn('Web Audio API failed for element, using fallback:', e);
                    continue;
                }
            }
            if (target.audioContextFailed) {
                continue;
            }
            const newVolume = window.localSoundVolume / 100;
            if (newVolume !== target.creategain.gain.value) {
                target.creategain.gain.value = newVolume;
            }
        }
    }
}

_browser().runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'changeSoundVolume') {
        if (request.data.soundVolume !== undefined) {
            window.localSoundVolume = Number(request.data.soundVolume);
            saveVolume(window.localSoundVolume);
            changeSoundVolume(window.document);
        }
        sendResponse({soundVolume: window.localSoundVolume});
    } else if (request.action === 'getSoundVolume') {
        sendResponse({soundVolume: window.localSoundVolume});
    }
});
