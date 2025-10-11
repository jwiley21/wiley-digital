// ===== Ably + WebRTC Instant Share (signaling via Ably, file bytes via WebRTC) =====

// ---------- CONFIG ----------
const USE_DIRECT_KEY_FOR_DEV = true; // set false if you add a token endpoint (see bottom)
const ABLY_API_KEY = "dtzUTA.S_fa1A:mjXt7bYFpcdHWm7moXmAM0QnLwItwUewRqSJ97nbmjA"; // Replace this with your actual Ably API key
const ABLY_AUTH_URL = "/api/ably-token"; // if you implement token endpoint
const CHANNEL_PREFIX = "rtc:"; // match your Ably namespace restriction if set

// Enhanced RTC config for Safari compatibility
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ],
  iceCandidatePoolSize: 10 // Helps with Safari connection issues
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
  
  // Try to generate QR code
  console.log("🔄 Attempting to generate QR code...");
  console.log("QRCode available:", typeof window.QRCode !== 'undefined');
  
  // Wait a moment for QR library to load if needed
  setTimeout(() => {
    if (typeof window.QRCode !== 'undefined') {
      try {
        console.log("📱 Generating QR code for:", url);
        
        const qrContainer = document.createElement('div');
        qrContainer.style.textAlign = 'center';
        qrContainer.style.marginTop = '16px';
        
        const qrTitle = document.createElement('p');
        qrTitle.textContent = 'Scan with your phone:';
        qrTitle.style.margin = '0 0 12px 0';
        qrTitle.style.fontSize = '0.9rem';
        qrTitle.style.color = 'var(--muted)';
        qrContainer.appendChild(qrTitle);
        
        window.QRCode.toCanvas(url, { 
          width: 200, 
          margin: 2,
          color: {
            dark: '#e5e7eb',
            light: '#0b0d12'
          }
        }, (err, canvas) => {
          if (!err && canvas) {
            canvas.style.borderRadius = '12px';
            canvas.style.background = '#e5e7eb';
            canvas.style.padding = '8px';
            qrContainer.appendChild(canvas);
            console.log("✅ QR code generated successfully");
          } else {
            console.error("❌ QR canvas generation failed:", err);
            qrContainer.innerHTML = '<p style="color: var(--muted); font-style: italic;">QR code generation failed</p>';
          }
        });
        
        els.qr.appendChild(qrContainer);
        
      } catch (error) {
        console.error("❌ QR code generation error:", error);
        const errorDiv = document.createElement('p');
        errorDiv.textContent = 'QR code generation failed - use the URL above';
        errorDiv.style.color = 'var(--muted)';
        errorDiv.style.fontStyle = 'italic';
        errorDiv.style.marginTop = '16px';
        els.qr.appendChild(errorDiv);
      }
    } else {
      console.warn("⚠️ QR Code library not available");
      const fallbackDiv = document.createElement('p');
      fallbackDiv.textContent = 'QR library not loaded - use the URL above';
      fallbackDiv.style.color = 'var(--muted)';
      fallbackDiv.style.fontStyle = 'italic';
      fallbackDiv.style.marginTop = '16px';
      els.qr.appendChild(fallbackDiv);
    }
  }, 500); // Give QR library time to load
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
      // Enable drag and drop visual feedback
      els.drop.style.cursor = 'pointer';
    } else if (pc.connectionState === 'failed') {
      log("❌ Connection failed. Try refreshing both devices.", false);
    } else if (pc.connectionState === 'disconnected') {
      log("🔌 Disconnected. Create a new room to reconnect.", false);
      els.drop.style.cursor = 'not-allowed';
    } else if (pc.connectionState === 'connecting') {
      log("🔄 Connecting to other device...", false);
    }
  };

  pc.onicegatheringstatechange = () => {
    console.log("🧊 ICE gathering state:", pc.iceGatheringState);
  };

  pc.oniceconnectionstatechange = () => {
    console.log("🧊 ICE connection state:", pc.iceConnectionState);
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
    let code = els.room.value.trim().toUpperCase() || randomRoom();
    els.room.value = code;
    console.log("📝 Room code:", code);

    const url = new URL(window.location.href);
    url.searchParams.set("room", code);
    els.qr.innerHTML = "";
    console.log("🔗 Room URL:", url.toString());
    
    log("Creating QR code...");
    makeQR(url.toString());

    log("Creating peer connection...");
    await createPeer();
    
    log("Opening Ably channel...");
    await openChannel(code, async (msg) => {
      console.log("📨 Received signal:", msg);
      if (msg.type === "answer") await handleAnswer(msg.sdp);
      if (msg.type === "ice") await handleIce(msg.candidate);
    });

    isHost = true;
    log("🏠 Room created! Share the QR code or room code with your other device.");
    
    log("Making WebRTC offer...");
    await makeOffer();
    console.log("✅ Host setup complete!");
  } catch (error) {
    console.error("❌ Host button error:", error);
    log("Error: " + error.message);
  }
});

els.joinBtn.addEventListener("click", async () => {
  const code = els.room.value.trim().toUpperCase();
  if (!code) {
    alert("Please enter a room code");
    return;
  }

  try {
    log("🔄 Joining room " + code + "...");
    
    await createPeer();
    await openChannel(code, async (msg) => {
      console.log("📨 Received message type:", msg.type);
      try {
        if (msg.type === "offer") {
          console.log("📞 Processing offer...");
          await handleOffer(msg.sdp);
        }
        if (msg.type === "ice") {
          console.log("🧊 Processing ICE candidate...");
          await handleIce(msg.candidate);
        }
      } catch (error) {
        console.error("❌ Error processing message:", error);
        log("❌ Connection error: " + error.message, false);
      }
    });

    log("🔄 Joined room. Waiting for host to connect...");
    
    // Set a timeout for connection
    setTimeout(() => {
      if (!pc || pc.connectionState !== 'connected') {
        log("⏰ Connection timeout. Make sure the host is online and try again.", false);
      }
    }, 30000); // 30 second timeout
    
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