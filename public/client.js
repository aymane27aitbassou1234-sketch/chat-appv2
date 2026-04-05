const socket = io();
let currentUser = null;
let targetUser = null;
let recorder = null;
let audioChunks = [];

/* small helpers */
const $ = id => document.getElementById(id);
function addClass(el, c){ el.classList.add(c); }
function removeClass(el, c){ el.classList.remove(c); }

/* animated show/hide for single-screen flow */
function animateShow(target){
  // target: DOM element to show; hides the other screen
  const auth = $("authSection");
  const chat = $("chatSection");
  const showEl = target === "auth" ? auth : chat;
  const hideEl = target === "auth" ? chat : auth;

  // if already visible, nothing
  if(!hideEl || !showEl) return;

  // exit animation for hideEl
  if(!hideEl.classList.contains("hidden")){
    addClass(hideEl, "screen-exit");
    requestAnimationFrame(()=> addClass(hideEl, "screen-exit-active"));
    setTimeout(()=>{
      removeClass(hideEl, "screen-exit");
      removeClass(hideEl, "screen-exit-active");
      hideEl.classList.add("hidden");
      // enter animation for showEl
      showEl.classList.remove("hidden");
      addClass(showEl, "screen-enter");
      requestAnimationFrame(()=> addClass(showEl, "screen-enter-active"));
      setTimeout(()=>{ removeClass(showEl, "screen-enter"); removeClass(showEl, "screen-enter-active"); }, 300);
    }, 240);
  } else {
    // direct show if hideEl already hidden
    showEl.classList.remove("hidden");
    addClass(showEl, "screen-enter");
    requestAnimationFrame(()=> addClass(showEl, "screen-enter-active"));
    setTimeout(()=>{ removeClass(showEl, "screen-enter"); removeClass(showEl, "screen-enter-active"); }, 300);
  }
}

/* persist session helpers */
function saveSession(username){ try{ localStorage.setItem("chat_user", username); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem("chat_user"); }catch(e){} }
function loadSession(){ try{ return localStorage.getItem("chat_user"); }catch(e){ return null; } }

/* init: restore session if present */
window.addEventListener("DOMContentLoaded", () => {
  const saved = loadSession();
  if(saved){
    currentUser = saved;
    $("meLabel").textContent = currentUser;
    animateShow("chat");
    socket.emit("login", currentUser);
  } else {
    animateShow("auth");
  }
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

  // Auto-login after register
  currentUser = data.username;
  saveSession(currentUser);
  $("meLabel").textContent = currentUser;
  socket.emit("login", currentUser);
  animateShow("chat");
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
  animateShow("chat");
}

/* ---------- Target & Messaging ---------- */
function setTarget(){
  const t = $("targetUser").value.trim();
  if(!t){ alert("Enter target username"); return; }
  targetUser = t;
  alert("Target set to: " + targetUser);
}

function sendMsg(){
  if(!currentUser || !targetUser) { alert("Login and set target first"); return; }
  const text = $("msgInput").value.trim();
  if(!text) return;
  socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "text", text });
  appendMessage({ user: currentUser, type: "text", text });
  $("msgInput").value = "";
}

socket.on("chatMessage", msg => appendMessage(msg));

/* ---------- UI helpers ---------- */
function appendMessage(msg){
  const ul = $("messages");
  const li = document.createElement("li");
  li.className = (msg.user === currentUser) ? "self" : "other";
  if(msg.type === "photo"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><img src="${msg.url}" alt="photo"></div>`;
  } else if(msg.type === "file"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><a href="${msg.url}" target="_blank">${escapeHtml(msg.original || 'file')}</a></div>`;
  } else if(msg.type === "voice"){
    li.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div><audio controls src="${msg.url}"></audio></div>`;
  } else {
    li.textContent = `${msg.user}: ${msg.text}`;
  }
  ul.appendChild(li);
  ul.scrollTop = ul.scrollHeight;
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------- Uploads & Voice (unchanged) ---------- */
function choosePhoto(){ $("photoInput").click(); }
$("photoInput").addEventListener("change", e => {
  const f = e.target.files[0];
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ev => $("photoPreview").innerHTML = `<img src="${ev.target.result}">`;
  reader.readAsDataURL(f);
});
async function uploadPhoto(){
  if(!targetUser || !currentUser){ alert("Login and set target"); return; }
  const f = $("photoInput").files[0];
  if(!f) { alert("Choose a photo first"); return; }
  const fd = new FormData(); fd.append("file", f);
  const res = await fetch('/upload', { method: "POST", body: fd });
  const data = await res.json();
  if(data.url){
    socket.emit("privateMessage", { toUser: targetUser, fromUser: currentUser, type: "photo", url: data.url });
    appendMessage({ user: currentUser, type: "photo", url: data.url });
    $("photoPreview").innerHTML = "";
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
      appendMessage({ user: currentUser, type: "voice", url: data.url });
    } else alert("Voice upload failed");
  };
}

/* ---------- Logout ---------- */
function logout(){
  currentUser = null;
  targetUser = null;
  clearSession();
  animateShow("auth");
  $("messages").innerHTML = "";
  socket.emit("logout");
}