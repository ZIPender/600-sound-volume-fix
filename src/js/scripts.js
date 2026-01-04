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
    
    // Single shared AudioContext for all media elements (browser limit is typically 6)
    let sharedAudioContext = null;
    
    // Map to track gain nodes for each media element
    const elementGainNodes = new WeakMap();
    
    // Set to track elements we've already added event listeners to
    const processedElements = new WeakSet();

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
                        // Access lastError to suppress "Unchecked runtime.lastError" warnings
                        // This is the standard pattern for handling potential disconnected ports
                        var lastError = getBrowser().runtime.lastError;
                        if (lastError) {
                            // Ignore - connection may have been closed
                        }
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

    // ============================================================
    // Audio Context Management (Part of changeSoundVolume rewrite)
    // ============================================================
    
    function getSharedAudioContext() {
        if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
            try {
                sharedAudioContext = new AudioContext();
            } catch (e) {
                return null;
            }
        }
        
        // Resume suspended AudioContext (browsers often suspend until user interaction)
        if (sharedAudioContext.state === 'suspended') {
            sharedAudioContext.resume().catch(function() {
                // Ignore resume errors
            });
        }
        
        return sharedAudioContext;
    }
    
    function setupAudioContext(mediaElement) {
        // Skip if already set up or if setup previously failed
        if (elementGainNodes.has(mediaElement)) {
            return elementGainNodes.get(mediaElement);
        }

        const src = mediaElement.src || mediaElement.currentSrc;
        
        // Skip elements with no source or ignored hosts
        if (!src || isIgnoredHost(src)) {
            return null;
        }

        try {
            const audioContext = getSharedAudioContext();
            if (!audioContext) {
                elementGainNodes.set(mediaElement, { failed: true });
                return null;
            }
            
            const gainNode = audioContext.createGain();
            const source = audioContext.createMediaElementSource(mediaElement);
            
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            const contextData = {
                gain: gainNode,
                source: source,
                failed: false
            };
            
            elementGainNodes.set(mediaElement, contextData);
            return contextData;
        } catch (e) {
            // Mark as failed so we don't retry
            elementGainNodes.set(mediaElement, { failed: true });
            return null;
        }
    }

    function applyVolumeToElement(mediaElement, volume) {
        const contextData = setupAudioContext(mediaElement);
        
        if (!contextData || contextData.failed) {
            return false;
        }

        const gainValue = volume / 100;
        const currentGainValue = contextData.gain.gain.value;
        
        if (currentGainValue !== gainValue) {
            // Use setValueAtTime for smooth audio transition (avoids clicks/pops)
            const audioContext = getSharedAudioContext();
            if (audioContext) {
                contextData.gain.gain.setValueAtTime(gainValue, audioContext.currentTime);
            } else {
                // Fallback to direct assignment if context unavailable
                contextData.gain.gain.value = gainValue;
            }
        }
        return true;
    }

    // ============================================================
    // Media Element Event Handling
    // Ensures volume is applied when media starts playing
    // ============================================================
    
    function onMediaPlay(event) {
        const element = event.target;
        // Apply volume when media starts playing
        if (typeof browser !== 'undefined') {
            applyVolumeToElement(element, currentVolume);
        }
    }
    
    function processMediaElement(element) {
        // Skip if already processed
        if (processedElements.has(element)) {
            return;
        }
        processedElements.add(element);
        
        // Add play event listener to apply volume when media starts
        element.addEventListener('play', onMediaPlay);
        
        // If already playing, apply volume immediately
        if (!element.paused && typeof browser !== 'undefined') {
            applyVolumeToElement(element, currentVolume);
        }
    }

    // ============================================================
    // Main Method: changeSoundVolume (Completely Rewritten)
    // Applies the current volume to all media elements
    // ============================================================
    
    function changeSoundVolume() {
        // Save volume for persistence
        saveVolume(currentVolume);
        
        // Notify background script (for Chrome tab capture fallback)
        // Fire-and-forget - we don't need to wait for the result
        sendToBackground('changeSoundVolume').catch(function() {
            // Silently ignore errors - background communication is best-effort
        });

        // In Chrome (browser API undefined), the background script handles volume
        // via tab capture API, so we skip the Web Audio API approach here.
        // In Firefox, we use Web Audio API directly on media elements.
        if (typeof browser === 'undefined') {
            return;
        }

        // Apply volume to all media elements
        const mediaElements = getMediaElements();
        mediaElements.forEach((element) => {
            processMediaElement(element);
            const src = element.src || element.currentSrc;
            if (src && !isIgnoredHost(src)) {
                applyVolumeToElement(element, currentVolume);
            }
        });
    }

    // ============================================================
    // MutationObserver for Dynamically Added Media Elements
    // ============================================================
    
    function setupMutationObserver() {
        const observer = new MutationObserver(function(mutations) {
            let hasNewMedia = false;
            
            mutations.forEach(function(mutation) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node is a media element
                        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                            processMediaElement(node);
                            hasNewMedia = true;
                        }
                        // Check for media elements within the added node
                        if (node.querySelectorAll) {
                            var mediaElements = node.querySelectorAll('video, audio');
                            mediaElements.forEach(function(el) {
                                processMediaElement(el);
                                hasNewMedia = true;
                            });
                        }
                    }
                });
            });
            
            // Apply volume to new elements if any were found
            if (hasNewMedia && typeof browser !== 'undefined') {
                getMediaElements().forEach(function(element) {
                    if (!element.paused) {
                        applyVolumeToElement(element, currentVolume);
                    }
                });
            }
        });
        
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        
        return observer;
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
        loadSavedVolume().then(function() {
            // Process existing media elements on page
            getMediaElements().forEach(processMediaElement);
            
            // Set up observer for dynamically added elements
            setupMutationObserver();
        }).catch(function() {
            // Still set up observer even if loading volume failed
            getMediaElements().forEach(processMediaElement);
            setupMutationObserver();
        });
    }

    // Run initialization
    init();

})();
