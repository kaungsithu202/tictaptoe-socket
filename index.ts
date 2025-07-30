// server/index.ts (or your main server file)

import { createServer } from "node:http";
import express from "express";
import { Server, type Socket } from "socket.io";
import { v4 as uuidv4 } from "uuid"; // For generating unique IDs

// --- TypeScript Types ---
//
//

// type CreateRoomCallback = (response: {
// 	success: boolean;
// 	roomId?: string;
// 	roomData?: TicTacToeRoom;
// 	message?: string;
// }) => void;

// // For joinRoom callback
// type JoinRoomCallback = (response: {
// 	success: boolean;
// 	roomData?: TicTacToeRoom;
// 	message?: string;
// 	playerSymbol?: "X" | "O";
// }) => void;

// For room data sent by server
interface PartialTicTacToeRoom {
	id: string;
	name: string;
	memberCount: number;
	maxMembers: 2;
	createdAt: string;
	isPrivate: boolean;
	gameStatus: "waiting" | "playing" | "finished";
	needsPlayer: boolean;
}

// The full room object stored server-side

interface TicTacToeRoom {
	id: string;
	name: string;
	creator: string;
	members: string[];
	maxMembers: 2;
	isPrivate: boolean;
	createdAt: string;
	gameState: GameState;
}

// Game state details
interface GameState {
	board: (string | null)[];
	currentPlayer: string | null; // socket.id of current player
	gameStatus: "waiting" | "playing" | "finished";
	winner: string | null; // socket.id of winner, or 'draw'
	playerX: string | null; // socket.id of X player
	playerO: string | null; // socket.id of O player
	winLine?: number[]; // Optional: to store winning line indices
}

interface RoomData {
	name?: string;
	isPrivate?: boolean;
}

interface GameState {
	board: (string | null)[];
	currentPlayer: string | null; // socket.id of current player
	gameStatus: "waiting" | "playing" | "finished";
	winner: string | null; // socket.id of winner, or 'draw'
	playerX: string | null; // socket.id of X player
	playerO: string | null; // socket.id of O player
	winLine?: number[]; // To store winning line indices
}

type CreateRoomCallback = (response: {
	success: boolean;
	roomId?: string;
	roomData?: TicTacToeRoom;
	message?: string;
}) => void;

type JoinRoomCallback = (response: {
	success: boolean;
	roomData?: TicTacToeRoom;
	message?: string;
	playerSymbol?: "X" | "O";
}) => void;

interface SocketWithRoom extends Socket {
	roomId?: string; // Optional: To track which room the socket is currently in
}

// --- Server Setup ---

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3500;

const app = express();
const server = createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*", // Be more specific in production
		methods: ["GET", "POST"],
	},
});

// --- Global State ---

const activeRooms = new Map<string, TicTacToeRoom>();

// --- Helper Functions ---

function generateRoomId(): string {
	return uuidv4().substring(0, 8).toUpperCase();
}

function getPublicRooms(): PartialTicTacToeRoom[] {
	const rooms: PartialTicTacToeRoom[] = [];
	activeRooms.forEach((room, roomId) => {
		if (!room.isPrivate) {
			rooms.push({
				id: roomId,
				name: room.name,
				memberCount: room.members.length,
				maxMembers: 2,
				createdAt: room.createdAt,
				isPrivate: room.isPrivate,
				gameStatus: room.gameState.gameStatus,
				needsPlayer: room.members.length < 2,
			});
		}
	});
	return rooms;
}

function initializeGameState(): GameState {
	return {
		board: Array(9).fill(null),
		currentPlayer: null,
		gameStatus: "waiting",
		winner: null,
		playerX: null,
		playerO: null,
	};
}

function checkGameWinner(board: (string | null)[]): {
	winner: string | null;
	winLine: number[];
} {
	const lines = [
		[0, 1, 2],
		[3, 4, 5],
		[6, 7, 8], // rows
		[0, 3, 6],
		[1, 4, 7],
		[2, 5, 8], // columns
		[0, 4, 8],
		[2, 4, 6], // diagonals
	];

	for (const line of lines) {
		const [a, b, c] = line;
		if (board[a] && board[a] === board[b] && board[a] === board[c]) {
			return { winner: board[a] as string, winLine: line };
		}
	}

	if (!board.includes(null)) {
		return { winner: "draw", winLine: [] };
	}

	return { winner: null, winLine: [] };
}

// --- Socket Event Handlers ---

io.on("connection", (socket: SocketWithRoom) => {
	console.log(`🎮 Player connected: ${socket.id}`);

	// Initial room list broadcast
	socket.emit("roomList", getPublicRooms());

	// --- CREATE ROOM ---
	socket.on(
		"createRoom",
		(roomData: RoomData, callback: CreateRoomCallback) => {
			try {
				if (typeof callback !== "function") {
					console.warn(`createRoom called without callback by ${socket.id}`);
					return;
				}
				if (!roomData || typeof roomData !== "object") {
					return callback({
						success: false,
						message: "Invalid room data provided",
					});
				}

				let roomId: string;
				let attempts = 0;
				const maxAttempts = 50;
				do {
					roomId = generateRoomId();
					attempts++;
					if (attempts > maxAttempts) {
						return callback({
							success: false,
							message: "Failed to generate unique room ID. Please try again.",
						});
					}
				} while (activeRooms.has(roomId));

				const newRoom: TicTacToeRoom = {
					id: roomId,
					name:
						roomData.name?.trim() || `Tic-Tac-Toe ${roomId.substring(0, 4)}`,
					creator: socket.id,
					members: [socket.id],
					maxMembers: 2,
					isPrivate: roomData.isPrivate || false,
					createdAt: new Date().toISOString(),
					gameState: initializeGameState(),
				};

				newRoom.gameState.playerX = socket.id; // Creator is Player X
				activeRooms.set(roomId, newRoom);
				socket.join(roomId);
				socket.roomId = roomId; // Track room for socket

				callback({ success: true, roomId: roomId, roomData: newRoom });
				io.emit("roomList", getPublicRooms()); // Update list for all clients
				console.log(
					`✅ Room ${roomId} (${newRoom.name}) created by ${socket.id} (Player X)`,
				);
			} catch (error) {
				console.error("❌ Error creating room:", error);
				callback({
					success: false,
					message: "Internal server error while creating room",
				});
			}
		},
	);

	// --- JOIN ROOM ---
	socket.on("joinRoom", (roomId: string, callback: JoinRoomCallback) => {
		try {
			if (typeof callback !== "function") {
				console.warn(`joinRoom called without callback by ${socket.id}`);
				return;
			}
			if (!roomId || typeof roomId !== "string") {
				return callback({
					success: false,
					message: "Invalid room ID provided",
				});
			}
			if (!activeRooms.has(roomId)) {
				return callback({ success: false, message: "Room not found." });
			}

			const room = activeRooms.get(roomId)!;

			if (room.members.includes(socket.id)) {
				const playerSymbol = room.gameState.playerX === socket.id ? "X" : "O";

				console.log("playerSymbol", playerSymbol);

				return callback({
					success: true,
					roomData: room,
					message: "You are already in this room",
					playerSymbol: playerSymbol,
				});
			}
			if (room.members.length >= 2) {
				return callback({ success: false, message: "Room is full." });
			}

			// Assign as Player O
			room.members.push(socket.id);
			room.gameState.playerO = socket.id;
			room.gameState.gameStatus = "playing";
			room.gameState.currentPlayer = room.gameState.playerX; // X starts

			socket.join(roomId);
			socket.roomId = roomId; // Track room for socket

			// Notify existing player (creator)
			socket.to(roomId).emit("playerJoined", {
				message: `Player ${socket.id.substring(0, 4)} joined!`,
				gameState: room.gameState,
				opponentId: socket.id,
			});

			// Notify all in room about game start
			io.to(roomId).emit("gameStarted", {
				gameState: room.gameState,
				playerX: room.gameState.playerX,
				playerO: room.gameState.playerO,
				currentPlayer: room.gameState.currentPlayer,
			});

			io.emit("roomList", getPublicRooms()); // Update list for all clients

			callback({ success: true, roomData: room, playerSymbol: "O" });
			console.log(
				`✅ Player ${socket.id} joined room ${roomId} as Player O. Game started!`,
			);
		} catch (error) {
			console.error("❌ Error joining room:", error);
			callback({
				success: false,
				message: "Internal server error while joining room",
			});
		}
	});

	// --- LEAVE ROOM ---
	socket.on(
		"leaveRoom",
		(
			roomId: string,
			callback?: (response: { success: boolean; message?: string }) => void,
		) => {
			try {
				if (!roomId || typeof roomId !== "string") {
					if (callback)
						callback({ success: false, message: "Invalid room ID" });
					return;
				}
				if (!activeRooms.has(roomId)) {
					if (callback) callback({ success: false, message: "Room not found" });
					return;
				}

				const room = activeRooms.get(roomId)!;
				const memberIndex = room.members.indexOf(socket.id);

				if (memberIndex > -1) {
					room.members.splice(memberIndex, 1);
					socket.leave(roomId);
					socket.roomId = undefined; // Clear room tracking

					if (room.members.length === 0) {
						activeRooms.delete(roomId);
						console.log(`🗑️ Room ${roomId} deleted - no players left`);
					} else {
						// Reset game state and notify remaining player
						const remainingPlayerId = room.members[0];
						room.gameState = initializeGameState();
						room.gameState.playerX = remainingPlayerId; // Remaining player becomes X
						room.gameState.currentPlayer = remainingPlayerId;

						socket.to(roomId).emit("playerLeft", {
							message: "Opponent left. Waiting for a new player...",
							gameState: room.gameState,
						});
						console.log(
							`👋 Player ${socket.id} left room ${roomId}. Remaining: ${remainingPlayerId}`,
						);
					}
					io.emit("roomList", getPublicRooms());
					if (callback) callback({ success: true });
				} else {
					if (callback)
						callback({ success: false, message: "Not in this room" });
				}
			} catch (error) {
				console.error("❌ Error leaving room:", error);
				if (callback)
					callback({ success: false, message: "Internal server error" });
			}
		},
	);

	// --- MAKE MOVE ---
	socket.on(
		"makeMove",
		(
			data: { roomId: string; position: number; playerSymbol: "X" | "O" },
			callback: (response: { success: boolean; message?: string }) => void,
		) => {
			try {
				const { roomId, position, playerSymbol } = data;

				console.log("makeMove data", data);

				if (!roomId || typeof roomId !== "string")
					return callback({ success: false, message: "Invalid room ID" });
				if (typeof position !== "number" || position < 0 || position > 8)
					return callback({ success: false, message: "Invalid position" });
				if (playerSymbol !== "X" && playerSymbol !== "O")
					return callback({ success: false, message: "Invalid player symbol" });

				if (!activeRooms.has(roomId)) {
					return callback({ success: false, message: "Room not found" });
				}

				const room = activeRooms.get(roomId)!;

				// --- Validation Checks ---
				if (room.gameState.gameStatus !== "playing") {
					return callback({
						success: false,
						message: "Game is not currently playing",
					});
				}
				if (room.gameState.currentPlayer !== socket.id) {
					return callback({ success: false, message: "Not your turn" });
				}
				if (room.gameState.board[position] !== null) {
					return callback({
						success: false,
						message: "Position already taken",
					});
				}

				// --- Make the Move ---
				room.gameState.board[position] = playerSymbol;

				// --- Check for Winner / Draw ---
				const gameResult = checkGameWinner(room.gameState.board);

				if (gameResult.winner) {
					room.gameState.gameStatus = "finished";
					// Store the winner's socket ID or 'draw'
					room.gameState.winner =
						gameResult.winner === "draw"
							? "draw"
							: playerSymbol === gameResult.winner
								? socket.id
								: room.gameState.playerX === socket.id
									? room.gameState.playerX
									: room.gameState.playerO;
					room.gameState.winLine = gameResult.winLine;
				} else {
					// Switch turns
					room.gameState.currentPlayer =
						room.gameState.currentPlayer === room.gameState.playerX
							? room.gameState.playerO
							: room.gameState.playerX;
				}

				// --- Broadcast Update ---
				io.to(roomId).emit("gameMove", {
					gameState: room.gameState,
					position: position, // Useful for frontend animation
					playerSymbol: playerSymbol, // The symbol that was just placed
				});

				callback({ success: true });
			} catch (error) {
				console.error("❌ Error making move:", error);
				callback({ success: false, message: "Internal server error" });
			}
		},
	);

	// --- RESET GAME ---
	socket.on(
		"resetGame",
		(
			roomId: string,
			callback: (response: { success: boolean; message?: string }) => void,
		) => {
			try {
				if (!roomId || typeof roomId !== "string") {
					return callback({ success: false, message: "Invalid room ID" });
				}
				if (!activeRooms.has(roomId)) {
					return callback({ success: false, message: "Room not found" });
				}

				const room = activeRooms.get(roomId)!;

				// Only the creator or players can reset, or maybe anyone if game is finished
				if (room.creator !== socket.id && !room.members.includes(socket.id)) {
					return callback({
						success: false,
						message: "Only players in the room can reset",
					});
				}

				// Reset game state
				const resetState = initializeGameState();
				resetState.playerX = room.gameState.playerX; // Keep original players
				resetState.playerO = room.gameState.playerO;
				resetState.currentPlayer = room.gameState.playerX; // X starts again
				resetState.gameStatus = "playing";

				room.gameState = resetState;

				// Broadcast reset to all players in room
				io.to(roomId).emit("gameReset", {
					gameState: room.gameState,
				});

				callback({ success: true });
				console.log(`🔄 Game in room ${roomId} reset by ${socket.id}`);
			} catch (error) {
				console.error("❌ Error resetting game:", error);
				callback({ success: false, message: "Internal error" });
			}
		},
	);

	// --- DISCONNECT ---
	socket.on("disconnect", () => {
		console.log(`👋 Player disconnected: ${socket.id}`);
		const disconnectedRoomId = socket.roomId; // Get room before clearing

		// Remove user from any room they were in
		if (disconnectedRoomId && activeRooms.has(disconnectedRoomId)) {
			const room = activeRooms.get(disconnectedRoomId)!;
			const memberIndex = room.members.indexOf(socket.id);

			if (memberIndex > -1) {
				room.members.splice(memberIndex, 1);

				// Handle room deletion or game reset based on remaining players
				if (room.members.length === 0) {
					activeRooms.delete(disconnectedRoomId);
					console.log(
						`🗑️ Room ${disconnectedRoomId} deleted - no players left.`,
					);
				} else {
					// Reset game state and notify the remaining player
					const remainingPlayerId = room.members[0];
					room.gameState = initializeGameState();
					room.gameState.playerX = remainingPlayerId; // Remaining player becomes X
					room.gameState.currentPlayer = remainingPlayerId;

					socket.to(disconnectedRoomId).emit("playerDisconnected", {
						message: `Opponent disconnected. Waiting for a new player...`,
						gameState: room.gameState,
					});
					console.log(
						`💥 Player ${socket.id} disconnected from room ${disconnectedRoomId}. Remaining: ${remainingPlayerId}`,
					);
				}
				io.emit("roomList", getPublicRooms()); // Update room list
			}
		}
		socket.roomId = undefined; // Clean up socket property
	});
});

// --- Start Server ---
server.listen(PORT, () => {
	console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// --- Type Definitions (place these at the top or in a separate types file) ---
// Ensure these interfaces match your frontend's expectations.

// For createRoom callback
