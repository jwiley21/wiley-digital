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
  
  // Check if QR library is loaded
  if (typeof window.QRCode === 'undefined') {
    console.warn("⚠️ QR Code library not loaded, showing URL instead");
    els.qr.innerHTML = `<p><strong>Join URL:</strong><br><a href="${url}" target="_blank">${url}</a></p>`;
    return;
  }
  
  try {
    window.QRCode.toCanvas(url, { width: 180 }, (err, cvs) => {
      if (!err && cvs) {
        els.qr.appendChild(cvs);
        console.log("✅ QR code generated successfully");
      } else {
        console.error("❌ QR code generation failed:", err);
        els.qr.innerHTML = `<p><strong>Join URL:</strong><br><a href="${url}" target="_blank">${url}</a></p>`;
      }
    });
  } catch (error) {
    console.error("❌ QR code error:", error);
    els.qr.innerHTML = `<p><strong>Join URL:</strong><br><a href="${url}" target="_blank">${url}</a></p>`;
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

  pc.onicecandidate = e => {
    if (e.candidate) {
      console.log("🧊 Sending ICE candidate");
      sendSignal({ type: "ice", candidate: e.candidate });
    } else {
      console.log("🧊 All ICE candidates sent");
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
    log("Waiting for someone to join...");
    
    // Set a timeout for the connection
    setTimeout(() => {
      if (pc.connectionState !== 'connected') {
        console.warn("⚠️ No connection after 30 seconds");
        log("No one joined yet. Share the room code or QR code.");
      }
    }, 30000);
    
  } catch (error) {
    console.error("❌ Error making offer:", error);
    log("Error creating offer: " + error.message);
    throw error;
  }
}

async function handleOffer(sdp) {
  await pc.setRemoteDescription({ type: "offer", sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await sendSignal({ type: "answer", sdp: answer.sdp });
}

async function handleAnswer(sdp) {
  await pc.setRemoteDescription({ type: "answer", sdp });
}

async function handleIce(candidate) {
  try { await pc.addIceCandidate(candidate); } catch {}
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
  if (!code) return alert("Enter a room code");

  await createPeer();
  await openChannel(code, async (msg) => {
    if (msg.type === "offer") await handleOffer(msg.sdp);
    if (msg.type === "ice") await handleIce(msg.candidate);
  });

  log("🔄 Joined room. Connecting to host device...");
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