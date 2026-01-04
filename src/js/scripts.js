/**
 * 600% Sound Volume - Content Script
 * Handles volume amplification for media elements using Web Audio API
 */

(function() {
    'use strict';

    // ============================================================
    // State Management
    // ============================================================
    
    let currentVolume = 100;
    let lastAppliedVolume = null;
    
    // Map to track audio contexts for each media element
    const audioContexts = new WeakMap();

    // ============================================================
    // Configuration
    // ============================================================
    
    // Hosts where we should not modify media sources
    const IGNORED_HOSTS = [
        'cdn.videofarm.daum.net',
        'computerbase.de',
        'production.assets.clips.twitchcdn.net'
    ];

    // ============================================================
    // Browser API Helper
    // ============================================================
    
    function getBrowser() {
        return typeof browser !== 'undefined' ? browser : chrome;
    }

    // ============================================================
    // Method 1: loadSavedVolume (Completely Rewritten)
    // Loads the saved volume from storage on script initialization
    // ============================================================
    
    function loadSavedVolume() {
        return new Promise((resolve) => {
            try {
                getBrowser().storage.local.get({ savedVolume: 100 }, (result) => {
                    if (getBrowser().runtime.lastError) {
                        currentVolume = 100;
                        resolve(100);
                        return;
                    }
                    const vol = Number(result.savedVolume);
                    currentVolume = isNaN(vol) ? 100 : vol;
                    resolve(currentVolume);
                });
            } catch (e) {
                currentVolume = 100;
                resolve(100);
            }
        });
    }

    // ============================================================
    // Method 2: saveVolume (Completely Rewritten)
    // Saves the current volume to storage
    // ============================================================
    
    function saveVolume(volume) {
        try {
            const vol = Number(volume);
            if (!isNaN(vol) && vol >= 0 && vol <= 600) {
                getBrowser().storage.local.set({ savedVolume: vol });
            }
        } catch (e) {
            // Silently fail if storage is not available
        }
    }

    // ============================================================
    // Method 3: sendToBackground (Completely Rewritten)
    // Sends messages to the background script
    // ============================================================
    
    function sendToBackground(action) {
        return new Promise((resolve) => {
            try {
                getBrowser().runtime.sendMessage(
                    { action: action, data: { soundVolume: currentVolume } },
                    (response) => {
                        // Suppress any runtime errors
                        void getBrowser().runtime.lastError;
                        resolve(response);
                    }
                );
            } catch (e) {
                resolve(null);
            }
        });
    }

    // ============================================================
    // Helper Functions
    // ============================================================
    
    function isIgnoredHost(url) {
        if (!url) return false;
        return IGNORED_HOSTS.some((host) => url.includes(host));
    }

    function getMediaElements() {
        return Array.from(document.querySelectorAll('video, audio'));
    }

    function hasActiveMedia(mediaElements) {
        return mediaElements.some((el) => !el.paused);
    }

    // ============================================================
    // Audio Context Management (Part of changeSoundVolume rewrite)
    // ============================================================
    
    function setupAudioContext(mediaElement) {
        // Skip if already set up or if setup previously failed
        if (audioContexts.has(mediaElement)) {
            return audioContexts.get(mediaElement);
        }

        const src = mediaElement.src || mediaElement.currentSrc;
        
        // Skip elements with no source or ignored hosts
        if (!src || isIgnoredHost(src)) {
            return null;
        }

        try {
            const audioContext = new AudioContext();
            const gainNode = audioContext.createGain();
            const source = audioContext.createMediaElementSource(mediaElement);
            
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            const contextData = {
                context: audioContext,
                gain: gainNode,
                source: source,
                failed: false
            };
            
            audioContexts.set(mediaElement, contextData);
            return contextData;
        } catch (e) {
            // Mark as failed so we don't retry
            audioContexts.set(mediaElement, { failed: true });
            return null;
        }
    }

    function applyVolumeToElement(mediaElement, volume) {
        const contextData = setupAudioContext(mediaElement);
        
        if (!contextData || contextData.failed) {
            return false;
        }

        const gainValue = volume / 100;
        if (contextData.gain.gain.value !== gainValue) {
            contextData.gain.gain.value = gainValue;
        }
        return true;
    }

    // ============================================================
    // Main Method: changeSoundVolume (Completely Rewritten)
    // Applies the current volume to all media elements
    // ============================================================
    
    function changeSoundVolume() {
        const mediaElements = getMediaElements();
        
        // Only proceed if volume changed and there's active media
        if (currentVolume === lastAppliedVolume || !hasActiveMedia(mediaElements)) {
            return;
        }

        lastAppliedVolume = currentVolume;
        
        // Save volume for persistence
        saveVolume(currentVolume);
        
        // Notify background script (for Chrome tab capture fallback)
        sendToBackground('changeSoundVolume');

        // In Chrome, background script handles volume via tab capture
        // In Firefox, we use Web Audio API directly
        if (typeof browser === 'undefined') {
            return;
        }

        // Apply volume to each media element using Web Audio API
        mediaElements.forEach((element) => {
            const src = element.src || element.currentSrc;
            if (src && !isIgnoredHost(src)) {
                applyVolumeToElement(element, currentVolume);
            }
        });
    }

    // ============================================================
    // Message Handler
    // ============================================================
    
    function handleMessage(request, sender, sendResponse) {
        if (request.action === 'changeSoundVolume') {
            if (request.data && request.data.soundVolume !== undefined) {
                const newVolume = Number(request.data.soundVolume);
                if (!isNaN(newVolume) && newVolume >= 0 && newVolume <= 600) {
                    currentVolume = newVolume;
                    saveVolume(currentVolume);
                    changeSoundVolume();
                }
            }
            sendResponse({ soundVolume: currentVolume });
        } else if (request.action === 'getSoundVolume') {
            sendResponse({ soundVolume: currentVolume });
        }
        return true; // Keep message channel open for async response
    }

    // ============================================================
    // Initialization
    // ============================================================
    
    function init() {
        // Register message listener
        getBrowser().runtime.onMessage.addListener(handleMessage);
        
        // Load saved volume on startup
        loadSavedVolume();
    }

    // Run initialization
    init();

})();
