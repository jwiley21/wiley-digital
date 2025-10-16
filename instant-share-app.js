// ===== Ably + WebRTC Instant Share (signaling via Ably, file bytes via WebRTC) =====

// ---------- CONFIG ----------
const USE_DIRECT_KEY_FOR_DEV = true; // set false if you add a token endpoint (see bottom)
const ABLY_API_KEY = "dtzUTA.S_fa1A:mjXt7bYFpcdHWm7moXmAM0QnLwItwUewRqSJ97nbmjA"; // Replace this with your actual Ably API key
const ABLY_AUTH_URL = "/api/ably-token"; // if you implement token endpoint
const CHANNEL_PREFIX = "rtc:"; // match your Ably namespace restriction if set

// Enhanced RTC config with TURN servers for better NAT traversal
const rtcConfig = {
  iceServers: [
    // STUN servers for basic NAT traversal
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun.services.mozilla.com" },
    
    // Free TURN servers for difficult network situations
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject", 
      credential: "openrelayproject"
    },
    // Backup TURN server
    {
      urls: "turn:turn.bistri.com:80",
      username: "homeo",
      credential: "homeo"
    }
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all' // Use both STUN and TURN
};

const els = {
  room: document.getElementById("room"),
  hostBtn: document.getElementById("hostBtn"),
  joinBtn: document.getElementById("joinBtn"),
  status: document.getElementById("status"),
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  sendProg: document.getElementById("sendProg"),
  recvProg: document.getElementById("recvProg"),
  downloads: document.getElementById("downloads"),
  qr: document.getElementById("qr"),
};

let pc, dataChannel, ably, channel;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks works well across browsers
let isHost = false;
let connectionTimeout = null;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;

function log(s, isConnected = false) { 
  els.status.textContent = s; 
  console.log("📱 Status:", s);
  
  // Update status display styling
  if (isConnected) {
    els.status.classList.add('connected');
  } else {
    els.status.classList.remove('connected');
  }
}

// Retry connection logic
function retryConnection() {
  if (retryAttempts < MAX_RETRY_ATTEMPTS) {
    retryAttempts++;
    log(`🔄 Connection failed. Retrying... (${retryAttempts}/${MAX_RETRY_ATTEMPTS})`, false);
    setTimeout(() => {
      if (pc) {
        pc.close();
      }
      createPeer().then(() => {
        if (isHost) {
          makeOffer();
        }
      }).catch(error => {
        console.error("Retry failed:", error);
        if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
          log("❌ Connection failed after multiple attempts. Please refresh and try again.", false);
        } else {
          retryConnection();
        }
      });
    }, 2000 * retryAttempts); // Exponential backoff
  } else {
    log("❌ Connection failed after multiple attempts. Please refresh and try again.", false);
  }
}

// Reset retry counter on successful connection
function resetRetryCounter() {
  retryAttempts = 0;
  if (connectionTimeout) {
    clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }
}

// Safari detection and guidance
function checkSafariCompatibility() {
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isHTTP = location.protocol === 'http:';
  
  if ((isSafari || isIOS) && isHTTP) {
    console.warn("🍎 Safari detected with HTTP - some features may be limited");
    console.log("💡 For best experience:");
    console.log("   • Make sure both devices are on same WiFi");
    console.log("   • Try Chrome browser if issues persist");
    console.log("   • Check Safari Settings → Privacy → Prevent Cross-Site Tracking (disable)");
    
    // Show Safari-specific guidance
    if (els.status) {
      setTimeout(() => {
        if (els.status.textContent.includes('Safari detected')) {
          els.status.innerHTML += '<br><small>💡 For better connectivity: Use same WiFi network on both devices</small>';
        }
      }, 2000);
    }
  }
  
  return { isSafari, isIOS, isHTTP };
}
function roomTopic(code) { return CHANNEL_PREFIX + code.toUpperCase(); }

function randomRoom() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function makeQR(url) {
  console.log("🔄 makeQR called with URL:", url);
  els.qr.innerHTML = "";
  
  // Always show the URL first for immediate access
  const urlDiv = document.createElement('div');
  urlDiv.innerHTML = `
    <p style="margin-bottom: 16px; color: var(--muted); font-size: 0.9rem;">
      <strong>Room Code:</strong> ${els.room.value}
    </p>
    <p style="margin-bottom: 16px; font-size: 0.85rem;">
      <strong>Share this URL:</strong><br>
      <a href="${url}" target="_blank" style="color: var(--brand); word-break: break-all;">${url}</a>
    </p>
  `;
  els.qr.appendChild(urlDiv);
  
  // Generate QR code immediately if library is available
  generateQRCode(url);
  
  // Add debug panel
  addDebugInfo(url);
}

function addDebugInfo(url) {
  // Add a debug section for troubleshooting
  const debugDiv = document.createElement('div');
  debugDiv.style.marginTop = '20px';
  debugDiv.style.padding = '12px';
  debugDiv.style.background = 'rgba(255,255,255,0.05)';
  debugDiv.style.borderRadius = '8px';
  debugDiv.style.fontSize = '0.8rem';
  debugDiv.style.color = 'var(--muted)';
  
  debugDiv.innerHTML = `
    <details>
      <summary style="cursor: pointer; font-weight: 600; margin-bottom: 8px;">🔧 Debug Info (click to expand)</summary>
      <div style="line-height: 1.4;">
        <p><strong>Browser:</strong> ${navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome') ? 'Safari' : navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other'}</p>
        <p><strong>Platform:</strong> ${navigator.platform}</p>
        <p><strong>WebRTC Support:</strong> ${window.RTCPeerConnection ? '✅ Yes' : '❌ No'}</p>
        <p><strong>QR Library:</strong> ${typeof window.QRCode !== 'undefined' ? '✅ Loaded' : '❌ Not loaded'}</p>
        <p><strong>Ably Support:</strong> ${typeof window.Ably !== 'undefined' ? '✅ Loaded' : '❌ Not loaded'}</p>
        <p><strong>Room URL:</strong> <span style="word-break: break-all;">${url}</span></p>
        <p style="margin-top: 8px; font-size: 0.75rem;"><em>If connection fails, try using the same WiFi network on both devices.</em></p>
      </div>
    </details>
  `;
  
  els.qr.appendChild(debugDiv);
}

function generateQRCode(url, attempt = 1) {
  const maxAttempts = 8; // Increased attempts for better reliability
  console.log(`🔄 QR generation attempt ${attempt}/${maxAttempts}`);
  console.log("QRCode available:", typeof window.QRCode !== 'undefined');
  
  // Update debug info if available
  const qrDebug = document.getElementById('qr-debug');
  if (qrDebug) {
    const status = (typeof window.QRCode !== 'undefined') ? "✅ Loaded" : "❌ Not loaded";
    qrDebug.innerHTML = `<strong>QR Library:</strong> ${status} (Attempt ${attempt}/${maxAttempts})`;
  }
  
  if (typeof window.QRCode !== 'undefined') {
    try {
      console.log("📱 Generating QR code for:", url);
      
      // Clear any existing QR container first
      const existingQR = document.getElementById('qr-container');
      if (existingQR) {
        existingQR.remove();
      }
      
      const qrContainer = document.createElement('div');
      qrContainer.style.textAlign = 'center';
      qrContainer.style.marginTop = '16px';
      qrContainer.style.padding = '16px';
      qrContainer.style.backgroundColor = 'rgba(255,255,255,0.05)';
      qrContainer.style.borderRadius = '12px';
      qrContainer.style.border = '1px solid rgba(255,255,255,0.1)';
      qrContainer.id = 'qr-container';
      
      const qrTitle = document.createElement('p');
      qrTitle.textContent = 'Scan with your phone:';
      qrTitle.style.margin = '0 0 12px 0';
      qrTitle.style.fontSize = '0.9rem';
      qrTitle.style.color = 'var(--muted)';
      qrContainer.appendChild(qrTitle);
      
      els.qr.appendChild(qrContainer);
      console.log("📦 QR container added to DOM");
      
      // Generate QR code directly to canvas
      const canvas = document.createElement('canvas');
      canvas.style.borderRadius = '8px';
      canvas.style.backgroundColor = '#ffffff';
      canvas.style.padding = '12px';
      canvas.style.display = 'block';
      canvas.style.margin = '0 auto';
      canvas.style.maxWidth = '200px';
      canvas.style.height = 'auto';
      
      qrContainer.appendChild(canvas);
      
      // Generate QR code
      window.QRCode.toCanvas(canvas, url, { 
        width: 200, 
        margin: 2,
        color: {
          dark: '#000000',  // Black QR code
          light: '#ffffff'  // White background
        }
      }, (err) => {
        if (!err) {
          console.log("✅ QR code generated successfully");
        } else {
          console.error("❌ QR canvas generation failed:", err);
          canvas.remove();
          const errorMsg = document.createElement('p');
          errorMsg.textContent = '⚠️ QR code generation failed - use the URL above';
          errorMsg.style.color = 'var(--muted)';
          errorMsg.style.fontStyle = 'italic';
          errorMsg.style.margin = '20px 0';
          qrContainer.appendChild(errorMsg);
        }
      });
      
    } catch (error) {
      console.error("❌ QR code generation error:", error);
      console.log("🔄 Trying fallback QR generation method...");
      
      // Try fallback method with DataURL
      try {
        window.QRCode.toDataURL(url, { 
          width: 200, 
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff'
          }
        }, (err, dataUrl) => {
          if (!err && dataUrl) {
            const img = document.createElement('img');
            img.src = dataUrl;
            img.style.borderRadius = '8px';
            img.style.backgroundColor = '#ffffff';
            img.style.padding = '12px';
            img.style.display = 'block';
            img.style.margin = '16px auto';
            img.style.maxWidth = '200px';
            
            const qrContainer = document.getElementById('qr-container') || document.createElement('div');
            qrContainer.appendChild(img);
            
            if (!document.getElementById('qr-container')) {
              qrContainer.id = 'qr-container';
              qrContainer.style.textAlign = 'center';
              els.qr.appendChild(qrContainer);
            }
            
            console.log("✅ Fallback QR code generated successfully");
          } else {
            throw new Error('Fallback QR generation failed');
          }
        });
      } catch (fallbackError) {
        console.error("❌ Fallback QR generation also failed:", fallbackError);
        const errorDiv = document.createElement('p');
        errorDiv.textContent = '⚠️ QR code generation failed - use the URL above';
        errorDiv.style.color = 'var(--muted)';
        errorDiv.style.fontStyle = 'italic';
        errorDiv.style.marginTop = '16px';
        els.qr.appendChild(errorDiv);
      }
    }
  } else if (attempt < maxAttempts) {
    // Progressive backoff with longer delays
    const delay = attempt * 400; // 400ms, 800ms, 1200ms, etc.
    console.warn(`⚠️ QR Code library not ready, retry ${attempt + 1}/${maxAttempts} in ${delay}ms`);
    setTimeout(() => generateQRCode(url, attempt + 1), delay);
  } else {
    console.error("❌ QR Code library failed to load after multiple attempts");
    const fallbackDiv = document.createElement('div');
    fallbackDiv.style.textAlign = 'center';
    fallbackDiv.style.marginTop = '16px';
    fallbackDiv.style.padding = '16px';
    fallbackDiv.style.border = '1px dashed var(--muted)';
    fallbackDiv.style.borderRadius = '8px';
    fallbackDiv.innerHTML = `
      <p style="color: var(--muted); margin-bottom: 12px;">
        ⚠️ QR code generation unavailable
      </p>
      <p style="color: var(--muted); font-size: 0.8rem; margin-bottom: 12px;">
        Copy the URL above to share with other devices
      </p>
      <button onclick="location.reload()" style="padding: 8px 16px; background: var(--brand); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.8rem;">
        Reload Page
      </button>
      </p>
    `;
    els.qr.appendChild(fallbackDiv);
  }
}

// ---------- ABLY (signaling) ----------
async function ensureAbly() {
  if (ably) return ably;
  
  console.log("🔌 Connecting to Ably...");
  if (USE_DIRECT_KEY_FOR_DEV) {
    console.log("🔑 Using direct API key");
    // Dev-only: embeds API key (ok for personal testing)
    ably = new Ably.Realtime({ key: ABLY_API_KEY, echoMessages: false });
  } else {
    console.log("🎫 Using token auth");
    // Production: token auth endpoint
    ably = new Ably.Realtime({ authUrl: ABLY_AUTH_URL, echoMessages: false });
  }
  
  await new Promise((res, rej) => {
    ably.connection.once("connected", () => {
      console.log("✅ Ably connected!");
      res();
    });
    ably.connection.once("failed", (error) => {
      console.error("❌ Ably connection failed:", error);
      rej(new Error("Ably connection failed"));
    });
    ably.connection.once("suspended", () => {
      console.warn("⚠️ Ably connection suspended");
    });
  });
  return ably;
}

async function openChannel(code, onSignal) {
  console.log("🔗 Opening channel for room:", code);
  await ensureAbly();
  
  const channelName = roomTopic(code);
  console.log("📡 Channel name:", channelName);
  
  channel = ably.channels.get(channelName);
  
  channel.subscribe("signal", (msg) => {
    console.log("🎯 Received signal:", msg.data);
    onSignal(msg.data);
  });
  
  // Add error handling for channel
  channel.on('failed', (error) => {
    console.error("❌ Channel failed:", error);
    log("Channel error: " + error.message);
  });
  
  console.log("✅ Channel ready:", channelName);
}

async function sendSignal(payload) {
  console.log("📤 Sending signal:", payload.type);
  try {
    await channel.publish("signal", payload);
    console.log("✅ Signal sent successfully");
  } catch (error) {
    console.error("❌ Failed to send signal:", error);
    log("Signal error: " + error.message);
    throw error;
  }
}

// ---------- WEBRTC ----------
async function createPeer() {
  console.log("🔧 Creating WebRTC peer connection...");
  pc = new RTCPeerConnection(rtcConfig);
  pc.pendingIceCandidates = []; // Store ICE candidates before remote description

  pc.onicecandidate = e => {
    if (e.candidate) {
      console.log("🧊 Sending ICE candidate:", e.candidate.type);
      sendSignal({ type: "ice", candidate: e.candidate }).catch(error => {
        console.error("❌ Failed to send ICE candidate:", error);
      });
    } else {
      console.log("🧊 All ICE candidates sent (null candidate received)");
    }
  };

  pc.ondatachannel = (e) => {
    console.log("📺 Data channel received");
    dataChannel = e.channel;
    setupDataChannel();
  };

  pc.onconnectionstatechange = () => {
    console.log("🔄 Connection state:", pc.connectionState);
    if (pc.connectionState === 'connected') {
      log("✅ Connected! You can now share files between devices.", true);
      resetRetryCounter();
      els.drop.style.cursor = 'pointer';
    } else if (pc.connectionState === 'failed') {
      log("❌ Connection failed. Attempting to reconnect...", false);
      retryConnection();
    } else if (pc.connectionState === 'disconnected') {
      log("🔌 Disconnected. Create a new room to reconnect.", false);
      els.drop.style.cursor = 'not-allowed';
    } else if (pc.connectionState === 'connecting') {
      log("🔄 Connecting to other device...", false);
      // Set a timeout for this connection attempt
      connectionTimeout = setTimeout(() => {
        if (pc.connectionState !== 'connected') {
          log("⏰ Connection timeout. Trying different approach...", false);
          retryConnection();
        }
      }, 15000); // 15 second timeout per attempt
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log("🧊 ICE gathering state:", pc.iceGatheringState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log("🧊 ICE connection state:", pc.iceConnectionState);
    
    // Add diagnostic information
    if (pc.iceConnectionState === 'failed') {
      console.error("🚨 ICE connection failed - this usually means NAT traversal issues");
      console.log("💡 Troubleshooting tips:");
      console.log("   • Ensure both devices are on stable internet");
      console.log("   • Try using same WiFi network");
      console.log("   • Check if corporate firewall is blocking WebRTC");
    } else if (pc.iceConnectionState === 'checking') {
      console.log("🔍 ICE candidates being tested...");
    } else if (pc.iceConnectionState === 'connected') {
      console.log("✅ ICE connection established!");
    }
  };

  console.log("✅ Peer connection created");
}

function setupDataChannel() {
  dataChannel.binaryType = "arraybuffer";

  dataChannel.onopen = () => {
    log("✅ Connected! Ready to share files.", true);
    els.drop.style.cursor = 'pointer';
  };
  dataChannel.onclose = () => {
    log("🔌 Connection closed.", false);
    els.drop.style.cursor = 'not-allowed';
  };
  dataChannel.onerror = (e) => {
    log("❌ Connection error: " + (e.message || e.toString()), false);
    els.drop.style.cursor = 'not-allowed';
  };

  let incoming = null;

  dataChannel.onmessage = (e) => {
    const msg = e.data;
    if (typeof msg === "string") {
      try {
        const ctrl = JSON.parse(msg);
        if (ctrl.type === "meta") {
          incoming = {
            name: ctrl.name,
            size: ctrl.size,
            mime: ctrl.mime,
            received: 0,
            chunks: [],
          };
          els.recvProg.value = 0;
          els.recvProg.max = 100;
        } else if (ctrl.type === "done") {
          const blob = new Blob(incoming.chunks, { type: incoming.mime || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = incoming.name || "file";
          const fileSize = incoming.size > 1024 * 1024 
            ? `${(incoming.size/1024/1024).toFixed(2)} MB`
            : `${(incoming.size/1024).toFixed(1)} KB`;
          a.textContent = `📥 ${incoming.name} (${fileSize})`;
          a.title = `Click to download ${incoming.name}`;
          els.downloads.appendChild(a);
          incoming = null;
          els.recvProg.value = 100;
          
          // Show completion message
          log(`✅ Received "${incoming?.name || 'file'}" successfully!`, true);
        }
      } catch {
        // ignore
      }
      return;
    }

    if (incoming) {
      incoming.chunks.push(msg);
      incoming.received += msg.byteLength;
      const pct = Math.min(100, Math.round((incoming.received / incoming.size) * 100));
      els.recvProg.value = pct;
    }
  };
}

async function makeOffer() {
  console.log("📞 Creating WebRTC offer...");
  
  try {
    dataChannel = pc.createDataChannel("file");
    setupDataChannel();

    console.log("📝 Creating offer...");
    const offer = await pc.createOffer();
    
    console.log("📝 Setting local description...");
    await pc.setLocalDescription(offer);
    
    console.log("📤 Sending offer via Ably...");
    await sendSignal({ type: "offer", sdp: offer.sdp });
    
    console.log("✅ Offer sent successfully");
    log("⏳ Waiting for someone to join using the room code or QR code...");
    
    // Set a timeout for the connection
    setTimeout(() => {
      if (pc.connectionState !== 'connected') {
        console.warn("⚠️ No connection after 60 seconds");
        log("⏰ Still waiting for connection. Make sure the other device is online and has joined the room.");
      }
    }, 60000); // Increased to 60 seconds
    
    // Also check periodically
    const checkInterval = setInterval(() => {
      if (pc.connectionState === 'connected') {
        clearInterval(checkInterval);
      } else if (pc.connectionState === 'failed') {
        clearInterval(checkInterval);
        log("❌ Connection failed. Try creating a new room.", false);
      }
    }, 5000);
    
  } catch (error) {
    console.error("❌ Error making offer:", error);
    log("Error creating offer: " + error.message);
    throw error;
  }
}

async function handleOffer(sdp) {
  try {
    console.log("📞 Setting remote description from offer...");
    await pc.setRemoteDescription({ type: "offer", sdp });
    
    // Process any pending ICE candidates
    if (pc.pendingIceCandidates && pc.pendingIceCandidates.length > 0) {
      console.log(`🧊 Processing ${pc.pendingIceCandidates.length} pending ICE candidates`);
      for (const candidate of pc.pendingIceCandidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.error("❌ Error adding pending ICE candidate:", error);
        }
      }
      pc.pendingIceCandidates = [];
    }
    
    console.log("📝 Creating answer...");
    const answer = await pc.createAnswer();
    
    console.log("📝 Setting local description...");
    await pc.setLocalDescription(answer);
    
    console.log("📤 Sending answer...");
    await sendSignal({ type: "answer", sdp: answer.sdp });
    
    log("📞 Answer sent, establishing connection...", false);
    console.log("✅ Answer process completed");
  } catch (error) {
    console.error("❌ Error handling offer:", error);
    log("❌ Failed to process connection offer: " + error.message, false);
    throw error;
  }
}

async function handleAnswer(sdp) {
  try {
    console.log("📞 Setting remote description from answer...");
    await pc.setRemoteDescription({ type: "answer", sdp });
    
    // Process any pending ICE candidates
    if (pc.pendingIceCandidates && pc.pendingIceCandidates.length > 0) {
      console.log(`🧊 Processing ${pc.pendingIceCandidates.length} pending ICE candidates`);
      for (const candidate of pc.pendingIceCandidates) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          console.error("❌ Error adding pending ICE candidate:", error);
        }
      }
      pc.pendingIceCandidates = [];
    }
    
    log("🔄 Connection established, finalizing...", false);
    console.log("✅ Answer processed successfully");
  } catch (error) {
    console.error("❌ Error handling answer:", error);
    log("❌ Failed to process connection answer: " + error.message, false);
    throw error;
  }
}

async function handleIce(candidate) {
  try {
    if (pc.remoteDescription) {
      await pc.addIceCandidate(candidate);
      console.log("🧊 ICE candidate added successfully");
    } else {
      console.log("⏳ Queuing ICE candidate (no remote description yet)");
      // Store ICE candidates if remote description isn't set yet
      if (!pc.pendingIceCandidates) pc.pendingIceCandidates = [];
      pc.pendingIceCandidates.push(candidate);
    }
  } catch (error) {
    console.error("❌ Error adding ICE candidate:", error);
  }
}

// ---------- UI wiring ----------
els.hostBtn.addEventListener("click", async () => {
  console.log("🎯 Host button clicked!");
  
  try {
    resetRetryCounter();
    let code = els.room.value.trim().toUpperCase() || randomRoom();
    els.room.value = code;
    console.log("📝 Room code:", code);

    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    els.qr.innerHTML = "";
    console.log("🔗 Room URL:", url.toString());
    
    log("📱 Creating QR code and room...");
    makeQR(url.toString());

    log("🔧 Setting up peer connection...");
    await createPeer();
    
    log("📡 Opening signaling channel...");
    await openChannel(code, async (msg) => {
      console.log("📨 Host received signal:", msg.type);
      try {
        if (msg.type === "ping") {
          console.log("👋 Joiner pinged - sending offer...");
          log("👋 Someone joined! Starting connection...");
          await makeOffer();
        }
        if (msg.type === "answer") {
          console.log("✅ Processing answer from joiner...");
          await handleAnswer(msg.sdp);
        }
        if (msg.type === "ice") {
          console.log("🧊 Processing ICE candidate from joiner...");
          await handleIce(msg.candidate);
        }
      } catch (error) {
        console.error("❌ Error handling signal:", error);
      }
    });

    isHost = true;
    log("🏠 Room ready! Share the QR code or room code with your other device.");
    log("⏳ Waiting for someone to join...");
    
    console.log("✅ Host setup complete - waiting for joiner to ping")
    
  } catch (error) {
    console.error("❌ Host button error:", error);
    log("❌ Host setup error: " + error.message);
  }
});

els.joinBtn.addEventListener("click", async () => {
  const code = els.room.value.trim().toUpperCase();
  if (!code) {
    alert("Please enter a room code");
    return;
  }

  try {
    resetRetryCounter();
    log("🔄 Joining room " + code + "...");
    console.log("🎯 Join button clicked for room:", code);
    
    await createPeer();
    await openChannel(code, async (msg) => {
      console.log("📨 Received message type:", msg.type);
      try {
        if (msg.type === "offer") {
          console.log("📞 Processing offer from host...");
          await handleOffer(msg.sdp);
          log("✅ Received offer from host. Sending answer back...");
        }
        if (msg.type === "ice") {
          console.log("🧊 Processing ICE candidate from host...");
          await handleIce(msg.candidate);
        }
      } catch (error) {
        console.error("❌ Error processing message:", error);
        log("❌ Connection error: " + error.message, false);
      }
    });

    // Send ping to notify host that joiner is ready
    log("👋 Notifying host that you've joined...");
    await sendSignal({ type: "ping" });

    isHost = false;
    log("🔄 Joined room successfully. Waiting for host connection...");
    
    // Improved timeout with better messaging
    const joinTimeout = setTimeout(() => {
      if (!pc || pc.connectionState !== 'connected') {
        log("⏰ No connection established yet. This could mean:", false);
        log("   • Host hasn't started sharing yet", false);
        log("   • Network/firewall blocking connection", false);
        log("   • Try refreshing and joining again", false);
      }
    }, 20000); // 20 second initial timeout
    
    // Clear timeout if connection succeeds
    const originalOnConnectionStateChange = pc.onconnectionstatechange;
    pc.onconnectionstatechange = (...args) => {
      if (pc.connectionState === 'connected') {
        clearTimeout(joinTimeout);
      }
      if (originalOnConnectionStateChange) {
        originalOnConnectionStateChange(...args);
      }
    };
    
  } catch (error) {
    console.error("❌ Join error:", error);
    log("❌ Failed to join room: " + error.message, false);
  }
});

// Auto-join via URL ?room=XXXXXX
const params = new URLSearchParams(location.search);
const autocode = (params.get("room") || "").toUpperCase();
if (autocode) {
  els.room.value = autocode;
  els.joinBtn.click();
}

// ---------- Sending files ----------
function sendFile(file) {
  if (!dataChannel || dataChannel.readyState !== "open") {
    log("❌ No connection available. Make sure both devices are connected.", false);
    return;
  }

  const fileSize = file.size > 1024 * 1024 
    ? `${(file.size/1024/1024).toFixed(2)} MB`
    : `${(file.size/1024).toFixed(1)} KB`;
  
  log(`📤 Sending "${file.name}" (${fileSize})...`);
  els.sendProg.value = 0; els.sendProg.max = 100;

  dataChannel.send(JSON.stringify({ type: "meta", name: file.name, size: file.size, mime: file.type }));

  const reader = file.stream().getReader();
  let sent = 0;

  const pump = () => reader.read().then(({ done, value }) => {
    if (done) {
      dataChannel.send(JSON.stringify({ type: "done" }));
      els.sendProg.value = 100;
      log(`✅ "${file.name}" sent successfully!`, true);
      return;
    }

    const sendChunk = () => {
      if (dataChannel.bufferedAmount > 4 * 1024 * 1024) {
        setTimeout(sendChunk, 20);
        return;
      }
      dataChannel.send(value);
      sent += value.byteLength;
      const pct = Math.min(100, Math.round((sent / file.size) * 100));
      els.sendProg.value = pct;
      pump();
    };
    sendChunk();
  });

  pump();
}

// Drag & drop + file input
["dragenter","dragover"].forEach(ev => els.drop.addEventListener(ev, e => {
  e.preventDefault(); els.drop.classList.add("drag");
}));
["dragleave","drop"].forEach(ev => els.drop.addEventListener(ev, e => {
  e.preventDefault(); els.drop.classList.remove("drag");
}));
els.drop.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) sendFile(file);
});
els.file.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) sendFile(file);
});

// Initialize and check compatibility
document.addEventListener('DOMContentLoaded', () => {
  console.log("🚀 Instant Share loading...");
  
  // Check QR library availability
  const qrAvailable = typeof window.QRCode !== 'undefined';
  console.log("📱 QR Library status:", qrAvailable ? "✅ Available" : "⚠️ Not loaded yet");
  
  const compat = checkSafariCompatibility();
  
  if (compat.isIOS || compat.isSafari) {
    log("🍎 Safari detected. Ensure both devices are on same WiFi network.");
  } else {
    log("💡 Ready! Create a room to start sharing files between devices.");
  }
  
  // Initial UI state
  els.drop.style.cursor = 'not-allowed';
  
  console.log("✅ Ready for connections!");
});