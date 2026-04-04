const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const fs = require("fs");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// ✅ Middleware to parse JSON and form data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const upload = multer({ dest: "uploads/" });

// Register
app.post("/register", (req, res) => {
  let users = fs.existsSync("users.json") ? JSON.parse(fs.readFileSync("users.json")) : [];
  const { username, password } = req.body;

  console.log("Register request body:", req.body); // Debug

  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "User already exists" });
  }

  users.push({ username, password });
  fs.writeFileSync("users.json", JSON.stringify(users));

  res.json({ success: true, username }); // ✅ Always send username
});

// Login
app.post("/login", (req, res) => {
  let users = fs.existsSync("users.json") ? JSON.parse(fs.readFileSync("users.json")) : [];
  const { username, password } = req.body;

  console.log("Login request body:", req.body); // Debug

  if (!username || !password) {
    return res.status(400).json({ error: "Missing username or password" });
  }

  const user = users.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  res.json({ success: true, username }); // ✅ Always send username
});

// Upload file
app.post("/upload", upload.single("file"), (req, res) => {
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Chat messages
io.on("connection", (socket) => {
  socket.on("chatMessage", (msg) => {
    io.emit("chatMessage", msg);

    let messages = fs.existsSync("messages.json") ? JSON.parse(fs.readFileSync("messages.json")) : [];
    messages.push(msg);
    fs.writeFileSync("messages.json", JSON.stringify(messages));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));