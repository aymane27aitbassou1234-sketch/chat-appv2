/* public/client.js — fixed: prevent duplicate messages, popup + animation helpers */

/* --- Config / timing --- */
const ANIM_DURATION_MS = 700;   // match CSS --anim-duration (700ms)
const POPUP_DURATION_MS = 1600; // match CSS --popup-duration (1600ms)

const socket = io();
let currentUser = null;
let targetUser = null;
let recorder = null;
let audioChunks = [];

const TARGET_KEY = "chat_target";

// track locally-sent message signatures to ignore server echoes
const pendingLocalSigs = new Set();
function makeSigFromText(user, type, textOrUrl){
  return `${user}|${type}|${String(textOrUrl || "")}`;
}

/* small helpers */
const $ = id => document.getElementById(id);
function addClass(el, c){ if(el) el.classList.add(c); }
function removeClass(el, c){ if(el) el.classList.remove(c); }

/* animated show/hide for single-screen flow (uses ANIM_DURATION_MS) */
function animateShow(target){
  const auth = $("authSection");
  const chat = $("chatSection");
  const showEl = target === "auth" ? auth : chat;
  const hideEl = target === "auth" ? chat : auth;
  if(!hideEl || !showEl) return;

  if(!hideEl.classList.contains("hidden")){
    addClass(hideEl, "screen-exit");
    requestAnimationFrame(()=> addClass(hideEl, "screen-exit-active"));
    setTimeout(()=>{
      removeClass(hideEl, "screen-exit");
      removeClass(hideEl, "screen-exit-active");
      hideEl.classList.add("hidden");

      showEl.classList.remove("hidden");
      addClass(showEl, "screen-enter");
      requestAnimationFrame(()=> addClass(showEl, "screen-enter-active"));

      setTimeout(()=>{
        removeClass(showEl, "screen-enter");
        removeClass(showEl, "screen-enter-active");
      }, ANIM_DURATION_MS);
    }, ANIM_DURATION_MS);
  } else {
    showEl.classList.remove("hidden");
    addClass(showEl, "screen-enter");
    requestAnimationFrame(()=> addClass(showEl, "screen-enter-active"));
    setTimeout(()=>{
      removeClass(showEl, "screen-enter");
      removeClass(showEl, "screen-enter-active");
    }, ANIM_DURATION_MS);
  }
}

/* persist session helpers */
function saveSession(username){ try{ localStorage.setItem("chat_user", username); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem("chat_user"); }catch(e){} }
function loadSession(){ try{ return localStorage.getItem("chat_user"); }catch(e){ return null; } }

/* --- Big popup (THE AKAN) --- */
function showBigPopup(text = 'THE AKAN.V3') {
  // If already present, update text and restart animation
  const existing = document.querySelector('.big-popup');
  if (existing) {
    const lbl = existing.querySelector('.label');
    if (lbl) lbl.textContent = text;
    existing.classList.remove('show');
    void existing.offsetWidth;
    existing.classList.add('show');
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'big-popup';
  wrapper.setAttribute('role', 'status');
  wrapper.setAttribute('aria-live', 'polite');

  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = text;

  wrapper.appendChild(label);
  document.body.appendChild(wrapper);

  // trigger animation
  requestAnimationFrame(() => wrapper.classList.add('show'));

  // cleanup after animation finishes
  setTimeout(() => {
    if (wrapper.parentElement) wrapper.parentElement.removeChild(wrapper);
  }, POPUP_DURATION_MS + 200);
}

/* --- Message helpers (animated entrance + optional float) --- */
function appendMessage(msg){
  const ul = $("messages");
  if(!ul) return;

  // optional dedupe: avoid exact duplicates (same user + text + url + ts)
  const last = ul.lastElementChild;
  if(last){
    const lastText = last.getAttribute("data-signature");
    const sig = `${msg.user}|${msg.type}|${msg.text || ""}|${msg.url || ""}`;
    if(lastText === sig) return; // skip duplicate
  }

  const li = document.createElement("li");
  li.className = (msg.user === currentUser) ? "self" : "other";
  li.setAttribute("data-signature", `${msg.user}|${msg.type}|${msg.text || ""}|${msg.url || ""}`);

  if(msg.type === "photo"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><img src="${msg.url}" alt="photo"></div>`;
  } else if(msg.type === "file"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><a href="${msg.url}" target="_blank" rel="noopener">${escapeHtml(msg.original || 'file')}</a></div>`;
  } else if(msg.type === "voice"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><audio controls src="${msg.url}"></audio></div>`;
  } else {
    // text message: use textContent to avoid injection
    li.textContent = `${msg.user}: ${msg.text}`;
  }

  // add entrance animation class and remove it after ANIM_DURATION_MS
  li.classList.add('msg-enter');
  ul.appendChild(li);
  // remove entrance class after animation completes
  setTimeout(()=> {
    li.classList.remove('msg-enter');
    // optional gentle float after entrance
    li.classList.add('msg-float');
  }, ANIM_DURATION_MS + 40);

  ul.scrollTop = ul.scrollHeight;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* Append a plain text message (convenience) */
function appendAnimatedMessage(text, type = 'self', floatAfter = true){
  const ul = $("messages");
  if(!ul) return;
  const li = document.createElement('li');
  li.className = `${type} msg-enter`;
  li.textContent = text;
  ul.appendChild(li);
  setTimeout(()=> {
    li.classList.remove('msg-enter');
    if(floatAfter) li.classList.add('msg-float');
  }, ANIM_DURATION_MS + 40);
  ul.scrollTop = ul.scrollHeight;
}

/* Typing indicator helpers */
function showTypingIndicator(){
  const ul = $("messages");
  if(!ul) return;
  if(ul.querySelector('.typing')) return; // already shown
  const li = document.createElement('li');
  li.className = 'other typing-wrap';
  li.innerHTML = `<div class="typing" id="typingIndicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>`;
  ul.appendChild(li);
  ul.scrollTop = ul.scrollHeight;
}
function hideTypingIndicator(){
  const el = document.getElementById('typingIndicator');
  if(el && el.parentElement) el.parentElement.remove();
}

/* ---------- Load recent messages ---------- */
async function loadRecentMessages(limit = 50){
  try {
    const res = await fetch(`/messages?limit=${limit}`);
    if(!res.ok) return;
    const msgs = await res.json();
    // server returns array of persisted messages; render them in order
    msgs.forEach(m => {
      appendMessage({ user: m.from, type: m.type, text: m.text, url: m.url, original: m.original });
    });
  } catch(e){ console.warn("load messages failed", e); }
}

/* ---------- Uploads & Voice ---------- */
function choosePhoto(){ $("photoInput").click(); }
const photoInputEl = $("photoInput");
if(photoInputEl){
  photoInputEl.addEventListener("change", e => {
    const f = e.target.files[0];
    if(!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = $("photoPreview");
      if(preview) preview.innerHTML = `<img src="${ev.target.result}">`;
    };
    reader.readAsDataURL(f);
  });
}
async function uploadPhoto(){
  if(!targetUser || !currentUser){ alert("Login and set target"); return; }
  const f = $("photoInput").files[0];
  if(!f) { alert("Choose a photo first"); return; }
  const fd = new FormData(); fd.append("file", f);
  const res = await fetch('/upload', { method: "POST", body: fd });
  const data = await res.json();
  if(data.url){
    // emit and add pending signature so server echo is ignored
    socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "photo", url: data.url });
    const sig = makeSigFromText(currentUser, "photo", data.url);
    pendingLocalSigs.add(sig);
    // append locally for immediate feedback
    appendMessage({ user: currentUser, type: "photo", url: data.url });
    const preview = $("photoPreview");
    if(preview) preview.innerHTML = "";
  } else alert("Upload failed");
}
async function uploadFile(){
  if(!targetUser || !currentUser){ alert("Login and set target"); return; }
  const f = $("fileInput").files[0];
  if(!f) { alert("Choose a file first"); return; }
  const fd = new FormData(); fd.append("file", f);
  const res = await fetch('/upload', { method: "POST", body: fd });
  const data = await res.json();
  if(data.url){
    socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "file", url: data.url, original: f.name });
    const sig = makeSigFromText(currentUser, "file", data.url);
    pendingLocalSigs.add(sig);
    appendMessage({ user: currentUser, type: "file", url: data.url, original: f.name });
  } else alert("Upload failed");
}
async function startRec(){
  if(!navigator.mediaDevices) { alert("No microphone support"); return; }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recorder = new MediaRecorder(stream);
  audioChunks = [];
  recorder.ondataavailable = e => audioChunks.push(e.data);
  recorder.start();
  alert("Recording started");
}
function stopRec(){
  if(!recorder) return;
  recorder.stop();
  recorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    const fd = new FormData(); fd.append("file", blob, "voice.webm");
    const res = await fetch('/upload', { method: "POST", body: fd });
    const data = await res.json();
    if(data.url){
      socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "voice", url: data.url });
      const sig = makeSigFromText(currentUser, "voice", data.url);
      pendingLocalSigs.add(sig);
      appendMessage({ user: currentUser, type: "voice", url: data.url });
    } else alert("Voice upload failed");
  };
}

/* ---------- Target & Messaging ---------- */
function setTarget(){
  const t = $("targetUser").value.trim();
  if(!t){ alert("Enter target username"); return; }
  targetUser = t;
  try { localStorage.setItem(TARGET_KEY, targetUser); } catch(e){}
  alert("Target set to: " + targetUser);
}

function sendMsg(){
  if(!currentUser || !targetUser) { alert("Login and set target first"); return; }
  const text = $("msgInput").value.trim();
  if(!text) return;

  // build signature and store it so we can ignore the server echo
  const sig = makeSigFromText(currentUser, "text", text);
  pendingLocalSigs.add(sig);

  // emit to server
  socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "text", text });

  // clear input and append locally for immediate feedback
  $("msgInput").value = "";
  appendAnimatedMessage(`${currentUser}: ${text}`, 'self');
}

/* ---------- Socket listener (single registration) ---------- */
socket.on("chatMessage", msg => {
  // normalize message fields (server may use user/from/fromUser)
  const user = msg.user || msg.from || msg.fromUser || "";
  const type = msg.type || "text";
  const payload = msg.text || msg.url || msg.original || "";

  const sig = makeSigFromText(user, type, payload);

  // if this message matches a locally-sent signature, remove the pending flag and skip appending
  if(pendingLocalSigs.has(sig)){
    pendingLocalSigs.delete(sig);
    return;
  }

  // otherwise render normally
  appendMessage({
    user,
    type,
    text: msg.text,
    url: msg.url,
    original: msg.original
  });
});

/* ---------- Auth ---------- */
async function register(){
  const username = $("regUser").value.trim();
  const password = $("regPass").value;
  if(!username || !password){ alert("Enter username and password"); return; }
  const res = await fetch('/register', {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if(data.error){ alert(data.error); return; }

  currentUser = data.username;
  saveSession(currentUser);
  $("meLabel").textContent = currentUser;
  socket.emit("login", currentUser);
  // show THE AKAN popup
  showBigPopup('THE AKAN.v3');
  animateShow("chat");
  loadRecentMessages();
}

async function login(){
  const username = $("loginUser").value.trim();
  const password = $("loginPass").value;
  if(!username || !password){ alert("Enter username and password"); return; }
  const res = await fetch('/login', {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if(data.error){ alert(data.error); return; }
  currentUser = data.username;
  saveSession(currentUser);
  $("meLabel").textContent = currentUser;
  socket.emit("login", currentUser);
  // show THE AKAN popup
  showBigPopup('THE AKAN.v3');
  animateShow("chat");
  loadRecentMessages();
}

/* ---------- Logout ---------- */
function logout(){
  currentUser = null;
  targetUser = null;
  clearSession();
  try { localStorage.removeItem(TARGET_KEY); } catch(e){}
  animateShow("auth");
  const msgs = $("messages");
  if(msgs) msgs.innerHTML = "";
  socket.emit("logout");
}

/* ---------- Init: restore session if present ---------- */
window.addEventListener("DOMContentLoaded", () => {
  const saved = loadSession();
  const savedTarget = (() => { try { return localStorage.getItem(TARGET_KEY); } catch(e){ return null; } })();
  if(savedTarget){
    targetUser = savedTarget;
    const tEl = $("targetUser");
    if(tEl) tEl.value = targetUser;
  }

  if(saved){
    currentUser = saved;
    const meLabel = $("meLabel");
    if(meLabel) meLabel.textContent = currentUser;
    animateShow("chat");
    socket.emit("login", currentUser);
    loadRecentMessages();
  } else {
    animateShow("auth");
  }

  // send on Enter
  const msgInput = $("msgInput");
  if(msgInput){
    msgInput.addEventListener("keydown", (e) => {
      if(e.key === "Enter" && !e.shiftKey){
        e.preventDefault();
        sendMsg();
      }
    });
  }

  // wire photo/file inputs safely if present (already handled above)
});

/* Expose some helpers to console for quick testing */
window.showBigPopup = showBigPopup;
window.appendAnimatedMessage = appendAnimatedMessage;
window.showTypingIndicator = showTypingIndicator;
window.hideTypingIndicator = hideTypingIndicator;
window.setTarget = setTarget;
window.logout = logout;
