const express = require("express");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { Server } = require("socket.io");

import type { Socket } from "socket.io";

const PORT = 3000;

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		// origin: [
		// 	"http://localhost:5173",
		// 	"http://127.0.0.1:5173",
		// 	"http://192.168.62.119:5173",
		// ],
		origin: "*",
	},
});

io.on("connection", (socket: Socket) => {
	console.log("a user connected", socket.id);

	socket.on("disconnect", () => {
		console.log("user disconnected");
	});

	socket.on("move", (data) => {
		console.log("data", data);
		socket.broadcast.emit("move", data);
	});

	socket.on("winnerData", (data) => {
		console.log("winnerData", data);
		socket.broadcast.emit("winnerData", data);
	});

	socket.on("reset", (data) => {
		console.log("reset", data);
		socket.broadcast.emit("reset", data);
	});
});

server.listen(PORT, () => {
	console.log(`server runnng at port 3000`);
});
