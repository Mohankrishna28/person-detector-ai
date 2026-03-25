document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('traceForm');
    const fileInput = document.getElementById('videoFile');
    const fileNameSpan = document.getElementById('fileName');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    
    const videoStream = document.getElementById('videoStream');
    const videoPlaceholder = document.getElementById('videoPlaceholder');
    const videoWrapper = document.getElementById('videoWrapper');
    
    const wsStatusDot = document.getElementById('wsStatusDot');
    const wsStatusText = document.getElementById('wsStatusText');
    const pauseBtn = document.getElementById('pauseBtn');
    const stopBtn = document.getElementById('stopBtn');
    const maxScoreDisplay = document.getElementById('maxScoreDisplay');
    const telemetryLog = document.getElementById('telemetryLog');

    let ws = null;
    let audioCtx = null;
    let isBeeping = false;
    let currentTaskId = null;
    let isPaused = false;
    let traceReportData = [];
    let isRedAlertActive = false;
    let redAlertOscillator = null;
    let redAlertLfo = null;

    function playBeep() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (isBeeping || audioCtx.state === 'suspended') return;
        isBeeping = true;
        
        try {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
            oscillator.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.start();
            oscillator.stop(audioCtx.currentTime + 0.3);
        } catch (e) {
            console.error(e);
        }
        
        // Changed to 2000 from 800 to be less annoying
        setTimeout(() => { isBeeping = false; }, 2000);
    }

    function addLog(message, type = '') {
        const li = document.createElement('li');
        li.className = `log-entry ${type}`;
        
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        
        li.textContent = `[${timeStr}] ${message}`;
        telemetryLog.appendChild(li);
        telemetryLog.parentElement.scrollTop = telemetryLog.parentElement.scrollHeight;
    }

    function setConnectingState() {
        btnText.classList.add('hidden');
        btnLoader.classList.remove('hidden');
        submitBtn.disabled = true;
        wsStatusDot.className = 'status-dot';
        wsStatusText.textContent = 'Initializing Trace...';
        maxScoreDisplay.textContent = '0%';
        maxScoreDisplay.className = 'score-value';
        videoWrapper.classList.remove('match-active');
        videoStream.classList.add('hidden');
        videoPlaceholder.classList.remove('hidden');
    }

    function setStreamingState() {
        wsStatusDot.className = 'status-dot active';
        wsStatusText.textContent = 'Active Telemetry';
        videoPlaceholder.classList.add('hidden');
        videoStream.classList.remove('hidden');
    }
    
    function resetState() {
        btnText.classList.remove('hidden');
        btnLoader.classList.add('hidden');
        submitBtn.disabled = false;
        wsStatusDot.className = 'status-dot';
        wsStatusText.textContent = 'System Idle';
        document.getElementById('pauseBtn').classList.add('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        videoStream.classList.add('hidden');
        videoPlaceholder.classList.remove('hidden');
        videoStream.src = '';
        currentTaskId = null;
        traceReportData = [];
        
        // Reset Intense Security State
        isRedAlertActive = false;
        document.body.classList.remove('red-alert-strobe');
        const modal = document.getElementById('redAlertModal');
        if (modal) modal.classList.add('hidden');
        if (redAlertOscillator) {
            redAlertOscillator.stop();
            redAlertOscillator.disconnect();
            redAlertOscillator = null;
        }
        if (redAlertLfo) {
            redAlertLfo.stop();
            redAlertLfo.disconnect();
            redAlertLfo = null;
        }
        
        const downloadBtn = document.getElementById('downloadReportBtn');
        if (downloadBtn) downloadBtn.classList.add('hidden');
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            fileNameSpan.textContent = e.target.files[0].name;
            addLog(`Video source acquired: ${e.target.files[0].name}`, 'system-msg');
        } else {
            fileNameSpan.textContent = 'No file chosen';
        }
    });

    document.body.addEventListener('click', () => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }, { once: true });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!fileInput.files.length) return;
        
        if (ws) ws.close();
        
        telemetryLog.innerHTML = '';
        const galleryWrapper = document.getElementById('galleryWrapper');
        if (galleryWrapper) {
            galleryWrapper.innerHTML = `
                <div id="galleryTarget_0" class="gallery-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.8rem; padding-right: 0.5rem;">
                    <p style="color: var(--text-muted); font-size: 0.85rem; grid-column: 1 / -1; margin: 0;">No targets captured yet...</p>
                </div>`;
        }
        
        // Reset Heatmap
        const fill = document.getElementById('timelineFill');
        if (fill) fill.style.width = '0%';
        const pins = document.getElementById('timelinePins');
        if (pins) pins.innerHTML = '';
        const startTracker = document.getElementById('timelineStart');
        if (startTracker) startTracker.textContent = '[00:00]';
        addLog('Initiating GuardianTrace protocol...', 'system-msg');
        setConnectingState();
        
        try {
            const protocol = window.location.protocol;
            const host = window.location.host;
            const uploadUrl = `${protocol}//${host}/upload`;
            
            const query = document.getElementById('description').value;
            const reqData = new FormData();
            reqData.append('video', fileInput.files[0]);
            reqData.append('description', query);
            
            const isThermal = document.getElementById('thermalModeToggle') ? document.getElementById('thermalModeToggle').checked : false;
            reqData.append('thermal_mode', isThermal);

            traceReportData = [
                `--- GUARDIANTRACE SECURITY REPORT ---`,
                `Generated: ${new Date().toLocaleString()}`,
                `Target Query: ${query}`,
                `Video Source: ${fileInput.files[0].name}`,
                `-------------------------------------`,
                ``
            ];
            
            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: reqData
            });
            
            const result = await response.json();
            
            if (result.status === 'success') {
                const keys = result.keywords_parsed.join(', ');
                addLog(`Upload success. Tracking ${result.target_count} targets: [${keys || 'none'}]`, 'system-msg');
                
                if (galleryWrapper && result.target_count > 0) {
                    galleryWrapper.innerHTML = '';
                    for(let i=0; i<result.target_count; i++) {
                        const galleryGrp = document.createElement('div');
                        const colors = ['#10B981', '#EAB308', '#EC4899', '#3B82F6'];
                        const color = colors[i % colors.length];
                        galleryGrp.style.borderLeft = `3px solid ${color}`;
                        galleryGrp.style.paddingLeft = '0.75rem';
                        galleryGrp.style.marginBottom = '0.5rem';
                        galleryGrp.innerHTML = `
                            <h4 style="font-size:0.85rem; color:${color}; margin:0 0 0.5rem 0; text-transform:uppercase; letter-spacing:0.5px;">Target ${i+1} Evidence</h4>
                            <div id="galleryTarget_${i}" class="gallery-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); gap: 0.8rem;">
                                <p style="color: var(--text-muted); font-size: 0.85rem; grid-column: 1 / -1; margin: 0;">Awaiting Target ${i+1}...</p>
                            </div>`;
                        galleryWrapper.appendChild(galleryGrp);
                    }
                }
                currentTaskId = result.task_id;
                isPaused = false;
                pauseBtn.classList.remove('hidden');
                pauseBtn.textContent = 'Pause';
                if (stopBtn) stopBtn.classList.remove('hidden');
                startWebSocket(result.task_id);
            } else {
                addLog(`Error: ${result.error}`, 'error-msg');
                resetState();
            }
        } catch (error) {
            addLog(`Network failure: ${error.message}`, 'error-msg');
            resetState();
        }
    });

    function startWebSocket(taskId) {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/ws/${taskId}`;
        
        addLog(`Connecting to secure socket stream...`, 'system-msg');
        ws = new WebSocket(wsUrl);
        
        let lastLoggedScore = 0;
        
        ws.onopen = () => {
            setStreamingState();
            addLog('Stream established. Commencing real-time target search.', 'system-msg');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.status === 'completed') {
                addLog('Trace protocol completed. End of stream.', 'system-msg');
                traceReportData.push(`\n[END OF LOG] Trace complete.`);
                
                let downloadBtn = document.getElementById('downloadReportBtn');
                if (!downloadBtn) {
                    const telemetryParent = document.getElementById('telemetryLog').parentElement.parentElement;
                    downloadBtn = document.createElement('button');
                    downloadBtn.id = 'downloadReportBtn';
                    downloadBtn.className = 'btn-primary glow-button';
                    downloadBtn.style.marginTop = '1rem';
                    downloadBtn.style.background = 'var(--success-color)';
                    downloadBtn.style.flexShrink = '0';
                    downloadBtn.style.zIndex = '10';
                    downloadBtn.innerHTML = '<span class="btn-text">📄 Download Security Report</span>';
                    telemetryParent.appendChild(downloadBtn);
                    
                    downloadBtn.addEventListener('click', () => {
                        if (traceReportData.length === 0) return;
                        const reportContent = traceReportData.join('\n');
                        const blob = new Blob([reportContent], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `GuardianTrace_Report_${Date.now()}.txt`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    });
                }

                if (traceReportData.length > 6) {
                    downloadBtn.classList.remove('hidden');
                }
                
                ws.close();
                return;
            }
            
            if (data.error) {
                addLog(`Stream Error: ${data.error}`, 'error-msg');
                return;
            }
            
            if (data.image) {
                videoStream.src = data.image;
            }
            
            if (data.snapshots && data.snapshots.length > 0) {
                data.snapshots.forEach(snap => {
                    const targetIdx = snap.target_index !== undefined ? snap.target_index : 0;
                    const gallery = document.getElementById(`galleryTarget_${targetIdx}`);
                    
                    if (gallery && gallery.querySelector('p')) {
                        gallery.innerHTML = '';
                    }
                    
                    traceReportData.push(`▶ [${snap.timestamp}] [Target ${targetIdx+1}] Evidence Captured - ID: ${snap.id}`);
                    addLog(`TARGET ${targetIdx+1} DETECTED at ${snap.timestamp} - Snapshot Extracted`, 'match-msg');
                    const div = document.createElement('div');
                    div.style.display = 'flex';
                    div.style.flexDirection = 'column';
                    div.style.gap = '0.4rem';
                    div.style.backgroundColor = 'rgba(255,255,255,0.03)';
                    div.style.padding = '0.5rem';
                    div.style.borderRadius = '8px';
                    div.style.border = '1px solid rgba(16, 185, 129, 0.4)';
                    div.style.boxShadow = '0 4px 6px rgba(0,0,0,0.2)';
                    
                    const img = document.createElement('img');
                    img.src = snap.image;
                    img.style.width = '100%';
                    img.style.aspectRatio = '1 / 1';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '4px';
                    
                    img.onclick = () => {
                        const modal = document.getElementById('lightboxModal');
                        const modalImg = document.getElementById('lightboxImg');
                        const captionText = document.getElementById('lightboxCaption');
                        if (modal && modalImg && captionText) {
                            modalImg.src = snap.image;
                            captionText.innerHTML = `Log Output: ${snap.timestamp} &bull; Tracker ID: ${snap.id}`;
                            modal.classList.remove('hidden');
                        }
                    };
                    
                    const lbl = document.createElement('div');
                    lbl.innerHTML = `${snap.timestamp}<br/><span style="font-size:0.65rem; color:var(--success-color);">ID: ${snap.id}</span>`;
                    lbl.style.fontSize = '0.75rem';
                    lbl.style.fontWeight = '600';
                    lbl.style.color = 'var(--text-muted)';
                    lbl.style.textAlign = 'center';
                    lbl.style.lineHeight = '1.3';
                    
                    div.appendChild(img);
                    div.appendChild(lbl);
                    if (gallery) {
                        gallery.appendChild(div);
                        const wrapper = document.getElementById('galleryWrapper');
                        if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
                    }
                    
                    // Drop Glowing Interpolation Pin on Heatmap
                    if (data.progress_pct !== undefined) {
                        const track = document.getElementById('timelinePins');
                        if (track) {
                            const colors = ['#10B981', '#EAB308', '#EC4899', '#3B82F6'];
                            const color = colors[targetIdx % colors.length];
                            const pin = document.createElement('div');
                            pin.style.position = 'absolute';
                            pin.style.left = `${data.progress_pct}%`;
                            pin.style.top = '0';
                            pin.style.bottom = '0';
                            pin.style.width = '3px';
                            pin.style.backgroundColor = color;
                            pin.style.boxShadow = `0 0 6px ${color}`;
                            pin.style.transform = 'translateX(-50%)';
                            pin.style.cursor = 'pointer';
                            pin.style.pointerEvents = 'auto'; // Ensure clicks bypass wrapper
                            pin.style.transition = 'all 0.1s ease';
                            
                            // Visual Hover Expansion
                            pin.onmouseenter = () => {
                                pin.style.width = '6px';
                                pin.style.zIndex = '50';
                                pin.style.boxShadow = `0 0 10px ${color}`;
                            };
                            pin.onmouseleave = () => {
                                pin.style.width = '3px';
                                pin.style.zIndex = '1';
                                pin.style.boxShadow = `0 0 6px ${color}`;
                            };
                            
                            // Lightbox Click Intercept
                            pin.onclick = (e) => {
                                e.stopPropagation();
                                const modal = document.getElementById('lightboxModal');
                                const modalImg = document.getElementById('lightboxImg');
                                const captionText = document.getElementById('lightboxCaption');
                                if (modal && modalImg && captionText) {
                                    modalImg.src = snap.image;
                                    captionText.innerHTML = `<span style="color:${color}; font-weight:bold;">Heatmap Pin Activation:</span> Target Timestamp ${snap.timestamp} &bull; Remote Tracker ID: ${snap.id}`;
                                    modal.classList.remove('hidden');
                                }
                            };
                            
                            track.appendChild(pin);
                        }
                    }
                });
            }
            
            // Render Live Telemetry Progression Frame
            if (data.progress_pct !== undefined) {
                const fill = document.getElementById('timelineFill');
                if (fill) fill.style.width = `${data.progress_pct}%`;
            }
            if (data.timestamp !== undefined) {
                const clock = document.getElementById('timelineStart');
                if (clock) clock.textContent = data.timestamp;
            }
            
            if (data.max_score !== undefined) {
                const score = data.max_score;
                maxScoreDisplay.textContent = `${score}%`;
                
                if (score >= 70) {
                    maxScoreDisplay.className = 'score-value high-score';
                    videoWrapper.classList.add('match-active');
                    playBeep();
                } else {
                    maxScoreDisplay.className = 'score-value';
                    videoWrapper.classList.remove('match-active');
                    if (score < 40) lastLoggedScore = 0;
                }
                
                // NEW: Intense Security Mode Lockdown Trigger
                const intenseToggle = document.getElementById('intenseModeToggle');
                if (score === 100 && !isRedAlertActive && intenseToggle && intenseToggle.checked) {
                    triggerRedAlertLockdown();
                }
            }
        };
        
        ws.onerror = () => {
            addLog('WebSocket connection failure.', 'error-msg');
            wsStatusDot.className = 'status-dot error';
            wsStatusText.textContent = 'Connection Error';
            resetState();
        };
        
        ws.onclose = () => {
            addLog('Connection closed. System idle.', 'system-msg');
            resetState();
        };
    }

    pauseBtn.addEventListener('click', async () => {
        if (!currentTaskId) return;
        
        isPaused = !isPaused;
        const endpoint = isPaused ? `/pause/${currentTaskId}` : `/resume/${currentTaskId}`;
        
        pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
        addLog(isPaused ? 'Stream paused by user.' : 'Stream resumed.', 'system-msg');
        
        try {
            const url = `${window.location.protocol}//${window.location.host}${endpoint}`;
            await fetch(url, { method: 'POST' });
        } catch (e) {
            console.error('Failed to toggle pause state', e);
        }
    });
    
    // Intense Security Catastrophe Routines
    function triggerRedAlertLockdown() {
        isRedAlertActive = true;
        addLog('[CRITICAL] 100% MATCH ACQUIRED. INITIATING RED ALERT LOCKDOWN.', 'error-msg');
        
        // 1. Physically Force Video Pause
        if (!isPaused && currentTaskId) {
            pauseBtn.click();
        }
        
        // 2. Overload the UI
        document.body.classList.add('red-alert-strobe');
        const modal = document.getElementById('redAlertModal');
        if (modal) modal.classList.remove('hidden');
        
        // 3. Hardware Speaker Siren Loop
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        try {
            redAlertOscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            redAlertOscillator.type = 'square';
            redAlertOscillator.frequency.value = 400; // Siren root frequency
            
            // LFO for sweeping effect
            redAlertLfo = audioCtx.createOscillator();
            redAlertLfo.type = 'triangle';
            redAlertLfo.frequency.value = 2; // Sweep speed
            
            const lfoGain = audioCtx.createGain();
            lfoGain.gain.value = 200; // Sweep depth
            
            redAlertLfo.connect(lfoGain);
            lfoGain.connect(redAlertOscillator.frequency);
            
            gainNode.gain.value = 0.15; // Volume
            
            redAlertOscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            redAlertLfo.start();
            redAlertOscillator.start();
        } catch (e) { console.error('Audio siren init failed:', e); }
    }
    
    // Acknowledge Button Disarm
    const ackBtn = document.getElementById('acknowledgeAlertBtn');
    if (ackBtn) {
        ackBtn.addEventListener('click', () => {
            addLog('[SYSTEM] Alert acknowledged. Removing lockdown overrides.', 'system-msg');
            document.body.classList.remove('red-alert-strobe');
            const modal = document.getElementById('redAlertModal');
            if (modal) modal.classList.add('hidden');
            
            if (redAlertOscillator) {
                redAlertOscillator.stop();
                redAlertOscillator.disconnect();
                redAlertOscillator = null;
            }
            if (redAlertLfo) {
                redAlertLfo.stop();
                redAlertLfo.disconnect();
                redAlertLfo = null;
            }
            
            isRedAlertActive = false;
            // Optionally auto-resume
            // if (isPaused && currentTaskId) pauseBtn.click();
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (ws) {
                ws.close();
            }
            addLog('Stream manually terminated. Ready for new video.', 'system-msg');
            resetState();
            fileInput.value = '';
            fileNameSpan.textContent = 'No file chosen';
        });
    }
    
    // Lightbox Close Handlers
    const lightboxModal = document.getElementById('lightboxModal');
    const lightboxClose = document.getElementById('lightboxClose');

    if (lightboxModal && lightboxClose) {
        lightboxClose.addEventListener('click', () => {
            lightboxModal.classList.add('hidden');
        });

        lightboxModal.addEventListener('click', (e) => {
            if (e.target === lightboxModal) {
                lightboxModal.classList.add('hidden');
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !lightboxModal.classList.contains('hidden')) {
                lightboxModal.classList.add('hidden');
            }
        });
    }

    // Download Report Logic
    const downloadReportBtn = document.getElementById('downloadReportBtn');
    if (downloadReportBtn) {
        downloadReportBtn.addEventListener('click', () => {
            if (traceReportData.length === 0) return;
            const reportContent = traceReportData.join('\n');
            const blob = new Blob([reportContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `GuardianTrace_Report_${Date.now()}.txt`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        });
    }
});
