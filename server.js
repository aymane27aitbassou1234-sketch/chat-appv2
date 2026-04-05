const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const UPLOADS = path.join(__dirname, "uploads");
const USERS_FILE = path.join(__dirname, "users.json");
const MESSAGES_FILE = path.join(__dirname, "messages.json");

if(!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
if(!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if(!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));

app.use(express.json());
app.use(express.static(PUBLIC));
app.use("/uploads", express.static(UPLOADS));

/* ---------- Multer for uploads ---------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename: (req, file, cb) => {
    const safe = Date.now() + "-" + Math.random().toString(36).slice(2,9) + path.extname(file.originalname);
    cb(null, safe);
  }
});
const upload = multer({ storage });

/* ---------- Auth endpoints ---------- */
function readUsers(){ return JSON.parse(fs.readFileSync(USERS_FILE, "utf8") || "[]"); }
function writeUsers(u){ fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

app.post("/register", (req, res) => {
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error: "Missing username or password" });
  const users = readUsers();
  if(users.find(u => u.username === username)) return res.status(400).json({ error: "Username taken" });
  users.push({ username, password });
  writeUsers(users);
  res.json({ username });
});

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if(!username || !password) return res.status(400).json({ error: "Missing username or password" });
  const users = readUsers();
  const u = users.find(x => x.username === username && x.password === password);
  if(!u) return res.status(400).json({ error: "Invalid credentials" });
  res.json({ username });
});

/* ---------- Upload endpoint ---------- */
app.post("/upload", upload.single("file"), (req, res) => {
  if(!req.file) return res.status(400).json({ error: "No file" });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url, original: req.file.originalname });
});

/* ---------- Socket.IO private messaging ---------- */
const socketsByUser = {}; // username -> socket.id

io.on("connection", socket => {
  socket.on("login", username => {
    if(!username) return;
    socketsByUser[username] = socket.id;
    socket.username = username;
  });

  socket.on("logout", () => {
    if(socket.username) delete socketsByUser[socket.username];
  });

  socket.on("privateMessage", msg => {
    // msg: { toUser, fromUser, type, text?, url?, original? }
    if(!msg || !msg.toUser || !msg.fromUser) return;
    const toSocketId = socketsByUser[msg.toUser];
    const payload = {
      user: msg.fromUser,
      type: msg.type || "text",
      text: msg.text || "",
      url: msg.url || "",
      original: msg.original || ""
    };

    // persist message
    try {
      const messages = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8") || "[]");
      messages.push({ to: msg.toUser, from: msg.fromUser, ...payload, ts: Date.now() });
      fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
    } catch (e) { console.error("persist error", e); }

    // emit to recipient if online
    if(toSocketId) io.to(toSocketId).emit("chatMessage", payload);
    // also emit back to sender (so both sides show)
    const fromSocketId = socketsByUser[msg.fromUser];
    if(fromSocketId) io.to(fromSocketId).emit("chatMessage", payload);
  });

  socket.on("disconnect", () => {
    if(socket.username) delete socketsByUser[socket.username];
  });
});

/* ---------- Start server ---------- */
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});