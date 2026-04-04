const socket = io();
let currentUser = null;
let targetUser = null;

// Register
function register() {
  const username = document.getElementById("regUser").value.trim();
  const password = document.getElementById("regPass").value.trim();

  if (!username || !password) {
    alert("Please enter both username and password.");
    return;
  }

  fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    console.log("Register response:", data);
    if (data.success) {
      currentUser = data.username;
      alert("Registered and logged in as " + currentUser);

      document.getElementById("authSection").style.display = "none";
      document.getElementById("chatSection").style.display = "block";
    } else {
      alert("Error: " + data.error);
    }
  })
  .catch(err => {
    console.error("Register error:", err);
    alert("Registration failed.");
  });
}

// Login
function login() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();

  if (!username || !password) {
    alert("Please enter both username and password.");
    return;
  }

  fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => {
    console.log("Login response:", data);
    if (data.success) {
      currentUser = data.username;
      alert("Logged in as " + currentUser);

      document.getElementById("authSection").style.display = "none";
      document.getElementById("chatSection").style.display = "block";
    } else {
      alert("Login failed: " + (data.error || ""));
    }
  })
  .catch(err => {
    console.error("Login error:", err);
    alert("Login failed.");
  });
}

// Logout
function logout() {
  currentUser = null;
  targetUser = null;
  document.getElementById("chat").innerHTML = "";
  document.getElementById("authSection").style.display = "block";
  document.getElementById("chatSection").style.display = "none";
}

// Set target user
function setTarget() {
  targetUser = document.getElementById("target").value.trim();
  if (!targetUser) {
    alert("Please enter a target username.");
    return;
  }
  alert("Chatting with " + targetUser);
}

// Send text message
function sendMsg() {
  const msg = document.getElementById("msg").value.trim();
  if (!currentUser) return alert("You must login first!");
  if (!targetUser) return alert("You must select a target user first!");
  if (!msg) return alert("Message cannot be empty.");

  socket.emit("chatMessage", { from: currentUser, to: targetUser, text: msg, type: "text" });
  document.getElementById("msg").value = "";
}

// File upload
function uploadFile() {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) return alert("Select a file first!");

  const formData = new FormData();
  formData.append("file", file);

  fetch("/upload", { method: "POST", body: formData })
    .then(res => res.json())
    .then(data => {
      socket.emit("chatMessage", { from: currentUser, to: targetUser, text: data.url, type: "file" });
    });
}

// Voice recording
let recorder;
let audioChunks = [];

function startRecording() {
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => audioChunks.push(e.data);
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");

        fetch("/upload", { method: "POST", body: formData })
          .then(res => res.json())
          .then(data => {
            socket.emit("chatMessage", { from: currentUser, to: targetUser, text: data.url, type: "audio" });
          });

        audioChunks = [];
      };
      recorder.start();
    });
}

function stopRecording() {
  if (recorder) recorder.stop();
}

// Chat rendering
socket.on("chatMessage", (msg) => {
  if ((msg.from === currentUser && msg.to === targetUser) ||
      (msg.from === targetUser && msg.to === currentUser)) {
    const li = document.createElement("li");

    if (msg.type === "file") {
      const link = document.createElement("a");
      link.href = msg.text;
      link.textContent = "Download file";
      link.target = "_blank";
      li.textContent = msg.from + ": ";
      li.appendChild(link);
    } else if (msg.type === "audio") {
      const audio = document.createElement("audio");
      audio.src = msg.text;
      audio.controls = true;
      li.textContent = msg.from + ": ";
      li.appendChild(audio);
    } else {
      li.textContent = msg.from + ": " + msg.text;
    }

    document.getElementById("chat").appendChild(li);
  }
});