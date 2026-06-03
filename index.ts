import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { Server, type Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid";

type PlayerSymbol = "X" | "O";
type GameStatus = "waiting" | "playing" | "finished";
type Winner = PlayerSymbol | "draw" | null;

interface GameState {
	board: (PlayerSymbol | null)[];
	currentPlayer: string | null;
	gameStatus: GameStatus;
	winner: Winner;
	playerX: string | null;
	playerO: string | null;
	winLine: number[];
	round: number;
}

interface TicTacToeRoom {
	id: string;
	name: string;
	creator: string;
	members: string[];
	player1: string;
	player2: string | null;
	score: {
		player1: number;
		player2: number;
	};
	maxMembers: 2;
	isPrivate: boolean;
	createdAt: string;
	gameState: GameState;
}

interface PublicRoom {
	id: string;
	name: string;
	memberCount: number;
	maxMembers: 2;
	createdAt: string;
	isPrivate: boolean;
	gameStatus: GameStatus;
	needsPlayer: boolean;
}

interface RoomData {
	name?: string;
	isPrivate?: boolean;
}

interface SocketWithRoom extends Socket {
	roomId?: string;
}

type Ack<T = unknown> = (response: T) => void;

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3500;
const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});

const activeRooms = new Map<string, TicTacToeRoom>();
const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));
app.get(/.*/, (_req, res) => {
	res.sendFile(path.join(publicPath, "index.html"));
});

function generateRoomId(): string {
	return uuidv4().replace(/-/g, "").slice(0, 6).toUpperCase();
}

function createInitialGameState(round = 1): GameState {
	return {
		board: Array<PlayerSymbol | null>(9).fill(null),
		currentPlayer: null,
		gameStatus: "waiting",
		winner: null,
		playerX: null,
		playerO: null,
		winLine: [],
		round,
	};
}

function getPublicRooms(): PublicRoom[] {
	return [...activeRooms.values()]
		.filter((room) => !room.isPrivate)
		.map((room) => ({
			id: room.id,
			name: room.name,
			memberCount: room.members.length,
			maxMembers: room.maxMembers,
			createdAt: room.createdAt,
			isPrivate: room.isPrivate,
			gameStatus: room.gameState.gameStatus,
			needsPlayer: room.members.length < room.maxMembers,
		}))
		.sort((a, b) => Number(b.needsPlayer) - Number(a.needsPlayer));
}

function getPlayerSymbol(room: TicTacToeRoom, socketId: string): PlayerSymbol | null {
	if (room.gameState.playerX === socketId) return "X";
	if (room.gameState.playerO === socketId) return "O";
	return null;
}

function addRoundWin(room: TicTacToeRoom, winner: Winner): void {
	if (winner === "draw" || winner === null) return;

	const winnerSocketId = winner === "X" ? room.gameState.playerX : room.gameState.playerO;
	if (winnerSocketId === room.player1) {
		room.score.player1 += 1;
		return;
	}
	if (winnerSocketId === room.player2) {
		room.score.player2 += 1;
	}
}

function checkGameWinner(board: (PlayerSymbol | null)[]): {
	winner: Winner;
	winLine: number[];
} {
	const lines = [
		[0, 1, 2],
		[3, 4, 5],
		[6, 7, 8],
		[0, 3, 6],
		[1, 4, 7],
		[2, 5, 8],
		[0, 4, 8],
		[2, 4, 6],
	];

	for (const line of lines) {
		const [a, b, c] = line;
		if (board[a] && board[a] === board[b] && board[a] === board[c]) {
			return { winner: board[a], winLine: line };
		}
	}

	if (!board.includes(null)) {
		return { winner: "draw", winLine: [] };
	}

	return { winner: null, winLine: [] };
}

function emitRoomList(): void {
	io.emit("roomList", getPublicRooms());
}

function emitRoomState(room: TicTacToeRoom): void {
	io.to(room.id).emit("roomState", room);
}

function removeSocketFromRoom(socket: SocketWithRoom, reason: "leave" | "disconnect" | "switch"): void {
	const roomId = socket.roomId;
	if (!roomId) return;

	const room = activeRooms.get(roomId);
	socket.leave(roomId);
	socket.roomId = undefined;

	if (!room) return;

	room.members = room.members.filter((memberId) => memberId !== socket.id);

	if (room.members.length === 0) {
		activeRooms.delete(roomId);
		emitRoomList();
		return;
	}

	const remainingPlayerId = room.members[0];
	room.creator = remainingPlayerId;
	room.player1 = remainingPlayerId;
	room.player2 = null;
	room.score = { player1: 0, player2: 0 };
	room.gameState = createInitialGameState(room.gameState.round + 1);
	room.gameState.playerX = remainingPlayerId;
	room.gameState.currentPlayer = null;

	io.to(roomId).emit(reason === "disconnect" ? "playerDisconnected" : "playerLeft", {
		message: "Opponent left. Waiting for a new player.",
		gameState: room.gameState,
	});
	emitRoomState(room);
	emitRoomList();
}

io.on("connection", (socket: SocketWithRoom) => {
	console.log(`Player connected: ${socket.id}`);
	socket.emit("roomList", getPublicRooms());

	socket.on("createRoom", (roomData: RoomData = {}, callback: Ack) => {
		if (typeof callback !== "function") return;

		removeSocketFromRoom(socket, "switch");

		let roomId = generateRoomId();
		let attempts = 0;
		while (activeRooms.has(roomId) && attempts < 50) {
			roomId = generateRoomId();
			attempts += 1;
		}

		if (activeRooms.has(roomId)) {
			callback({ success: false, message: "Could not create a unique room code." });
			return;
		}

		const gameState = createInitialGameState();
		gameState.playerX = socket.id;

		const room: TicTacToeRoom = {
			id: roomId,
			name: roomData.name?.trim().slice(0, 40) || `Match ${roomId}`,
			creator: socket.id,
			members: [socket.id],
			player1: socket.id,
			player2: null,
			score: {
				player1: 0,
				player2: 0,
			},
			maxMembers: 2,
			isPrivate: Boolean(roomData.isPrivate),
			createdAt: new Date().toISOString(),
			gameState,
		};

		activeRooms.set(roomId, room);
		socket.join(roomId);
		socket.roomId = roomId;

		callback({ success: true, roomId, roomData: room, playerSymbol: "X" });
		emitRoomList();
		console.log(`Room ${roomId} created by ${socket.id}`);
	});

	socket.on("joinRoom", (rawRoomId: string, callback: Ack) => {
		if (typeof callback !== "function") return;

		const roomId = rawRoomId?.trim().toUpperCase();
		const room = activeRooms.get(roomId);
		if (!room) {
			callback({ success: false, message: "Room not found." });
			return;
		}

		if (room.members.includes(socket.id)) {
			callback({
				success: true,
				roomData: room,
				playerSymbol: getPlayerSymbol(room, socket.id),
				message: "You are already in this room.",
			});
			return;
		}

		if (room.members.length >= room.maxMembers) {
			callback({ success: false, message: "Room is full." });
			return;
		}

		removeSocketFromRoom(socket, "switch");

		room.members.push(socket.id);
		room.player2 = socket.id;
		room.gameState.playerO = socket.id;
		room.gameState.currentPlayer = room.gameState.playerX;
		room.gameState.gameStatus = "playing";

		socket.join(room.id);
		socket.roomId = room.id;

		callback({ success: true, roomData: room, playerSymbol: "O" });
		io.to(room.id).emit("gameStarted", room);
		emitRoomState(room);
		emitRoomList();
		console.log(`Player ${socket.id} joined room ${room.id}`);
	});

	socket.on("leaveRoom", (callback?: Ack) => {
		removeSocketFromRoom(socket, "leave");
		callback?.({ success: true });
	});

	socket.on("makeMove", (data: { roomId: string; position: number }, callback: Ack) => {
		if (typeof callback !== "function") return;

		const roomId = data?.roomId?.trim().toUpperCase();
		const position = data?.position;
		const room = activeRooms.get(roomId);

		if (!room) {
			callback({ success: false, message: "Room not found." });
			return;
		}

		const playerSymbol = getPlayerSymbol(room, socket.id);
		if (!playerSymbol) {
			callback({ success: false, message: "Only players can move." });
			return;
		}

		if (room.gameState.gameStatus !== "playing") {
			callback({ success: false, message: "Game is not active." });
			return;
		}

		if (room.gameState.currentPlayer !== socket.id) {
			callback({ success: false, message: "Not your turn." });
			return;
		}

		if (!Number.isInteger(position) || position < 0 || position > 8) {
			callback({ success: false, message: "Invalid board position." });
			return;
		}

		if (room.gameState.board[position] !== null) {
			callback({ success: false, message: "That square is already taken." });
			return;
		}

		room.gameState.board[position] = playerSymbol;
		const result = checkGameWinner(room.gameState.board);

		if (result.winner) {
			room.gameState.gameStatus = "finished";
			room.gameState.winner = result.winner;
			room.gameState.currentPlayer = null;
			room.gameState.winLine = result.winLine;
			addRoundWin(room, result.winner);
		} else {
			room.gameState.currentPlayer =
				socket.id === room.gameState.playerX ? room.gameState.playerO : room.gameState.playerX;
		}

		io.to(room.id).emit("gameMove", {
			gameState: room.gameState,
			position,
			playerSymbol,
		});
		emitRoomState(room);
		emitRoomList();
		callback({ success: true });
	});

	socket.on("resetGame", (rawRoomId: string, callback: Ack) => {
		if (typeof callback !== "function") return;

		const roomId = rawRoomId?.trim().toUpperCase();
		const room = activeRooms.get(roomId);
		if (!room) {
			callback({ success: false, message: "Room not found." });
			return;
		}

		if (!room.members.includes(socket.id)) {
			callback({ success: false, message: "Only players can reset this match." });
			return;
		}

		if (room.members.length < 2) {
			callback({ success: false, message: "Waiting for an opponent." });
			return;
		}

		const nextState = createInitialGameState(room.gameState.round + 1);
		nextState.playerX = room.gameState.playerO;
		nextState.playerO = room.gameState.playerX;
		nextState.currentPlayer = nextState.playerX;
		nextState.gameStatus = "playing";
		room.gameState = nextState;

		io.to(room.id).emit("gameReset", room);
		emitRoomState(room);
		emitRoomList();
		callback({ success: true });
	});

	socket.on("disconnect", () => {
		console.log(`Player disconnected: ${socket.id}`);
		removeSocketFromRoom(socket, "disconnect");
	});
});

server.listen(PORT, () => {
	console.log(`Server running on http://localhost:${PORT}`);
});
