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

const players: { id: string; role: string }[] = [];

io.on("connection", (socket: Socket) => {
	if (players.length === 0) {
		players.push({ id: socket.id, role: "player1" });
	}

	if (players.length === 2) {
		players[0].role = "player1";
	}

	console.log("players", players);

	socket.emit("player-roles", players);

	socket.on("disconnect", () => {
		console.log("user disconnected");
		// players = players.filter((player) => player.id !== socket.id);
	});

	socket.on("move", (data) => {
		socket.broadcast.emit("move", data);
	});

	socket.on("winnerData", (data) => {
		socket.broadcast.emit("winnerData", data);
	});

	socket.on("reset", (data) => {
		socket.broadcast.emit("reset", data);
	});
});

server.listen(PORT, () => {
	console.log(`server runnng at port ${PORT}`);
});
