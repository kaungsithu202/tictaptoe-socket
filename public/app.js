const socket = io();

const state = {
	room: null,
	playerSymbol: null,
	lastRoomList: [],
	soundEnabled: true,
	lastResultKey: null,
	audio: {
		win: new Audio("/winning.mp3"),
		gameOver: new Audio("/game_over.mp3"),
	},
};

const elements = {
	connectionStatus: document.querySelector("#connectionStatus"),
	createForm: document.querySelector("#createForm"),
	joinForm: document.querySelector("#joinForm"),
	roomName: document.querySelector("#roomName"),
	privateRoom: document.querySelector("#privateRoom"),
	roomCode: document.querySelector("#roomCode"),
	roomList: document.querySelector("#roomList"),
	copyLinkButton: document.querySelector("#copyLinkButton"),
	matchName: document.querySelector("#matchName"),
	activeRoomCode: document.querySelector("#activeRoomCode"),
	player1Pill: document.querySelector("#player1Pill"),
	player2Pill: document.querySelector("#player2Pill"),
	player1Symbol: document.querySelector("#player1Symbol"),
	player2Symbol: document.querySelector("#player2Symbol"),
	player1Label: document.querySelector("#player1Label"),
	player2Label: document.querySelector("#player2Label"),
	player1Wins: document.querySelector("#player1Wins"),
	player2Wins: document.querySelector("#player2Wins"),
	roundPill: document.querySelector("#roundPill"),
	statusText: document.querySelector("#statusText"),
	resultBanner: document.querySelector("#resultBanner"),
	resultKicker: document.querySelector("#resultKicker"),
	resultTitle: document.querySelector("#resultTitle"),
	resultDetail: document.querySelector("#resultDetail"),
	board: document.querySelector("#board"),
	resetButton: document.querySelector("#resetButton"),
	leaveButton: document.querySelector("#leaveButton"),
	soundButton: document.querySelector("#soundButton"),
	toast: document.querySelector("#toast"),
};

function toast(message) {
	elements.toast.textContent = message;
	elements.toast.classList.add("show");
	window.clearTimeout(toast.timeout);
	toast.timeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function emitWithAck(event, payload) {
	return new Promise((resolve) => {
		if (payload === undefined) {
			socket.emit(event, resolve);
			return;
		}
		socket.emit(event, payload, resolve);
	});
}

function updateUrl(roomId) {
	const url = new URL(window.location.href);
	if (roomId) {
		url.searchParams.set("room", roomId);
	} else {
		url.searchParams.delete("room");
	}
	window.history.replaceState({}, "", url);
}

function setRoom(room, playerSymbol) {
	state.room = room;
	state.playerSymbol = playerSymbol ?? state.playerSymbol;
	updateUrl(room?.id);
	renderGame();
}

function getPlayerLabel(socketId) {
	if (!socketId) return "Waiting";
	if (socketId === socket.id) return "You";
	return "Opponent";
}

function getSymbolForPlayer(socketId) {
	if (!state.room || !socketId) return "-";
	if (state.room.gameState.playerX === socketId) return "X";
	if (state.room.gameState.playerO === socketId) return "O";
	return "-";
}

function formatWins(count) {
	return `${count} ${count === 1 ? "win" : "wins"}`;
}

function getStatusText() {
	if (!state.room) return "Create or join a room to start.";

	const game = state.room.gameState;
	if (game.gameStatus === "waiting") return "Waiting for an opponent.";
	if (game.gameStatus === "finished") {
		if (game.winner === "draw") return "Draw. Start a rematch.";
		return game.winner === state.playerSymbol ? "You won. Start a rematch." : "Opponent won. Start a rematch.";
	}
	if (game.currentPlayer === socket.id) return `Your turn as ${state.playerSymbol}.`;
	return "Opponent is thinking.";
}

function getResultView() {
	if (!state.room) {
		return {
			tone: "idle",
			kicker: "Match result",
			title: "Waiting for a game",
			detail: "Create or join a room to begin.",
		};
	}

	const game = state.room.gameState;
	if (game.gameStatus === "waiting") {
		return {
			tone: "idle",
			kicker: "Room open",
			title: "Waiting for an opponent",
			detail: "Share the room code or invite link to start the round.",
		};
	}

	if (game.gameStatus !== "finished") {
		const isYourTurn = game.currentPlayer === socket.id;
		return {
			tone: "playing",
			kicker: `Round ${game.round}`,
			title: isYourTurn ? "Your move" : "Opponent's move",
			detail: isYourTurn ? `Place ${state.playerSymbol} on an open square.` : "Hold tight while the next move lands.",
		};
	}

	if (game.winner === "draw") {
		return {
			tone: "draw",
			kicker: "Round complete",
			title: "Draw",
			detail: "The board filled up. Start a rematch to settle it.",
		};
	}

	const didWin = game.winner === state.playerSymbol;
	return {
		tone: didWin ? "win" : "lose",
		kicker: didWin ? "Victory" : "Round lost",
		title: didWin ? "You won" : "You lost",
		detail: didWin ? "Three in a row. Run it back?" : "The opponent connected three. Try a rematch.",
	};
}

function primeAudio() {
	for (const audio of Object.values(state.audio)) {
		audio.preload = "auto";
		audio.load();
	}
}

function playResultSound(tone) {
	if (!state.soundEnabled) return;
	const audio = tone === "win" ? state.audio.win : state.audio.gameOver;
	audio.currentTime = 0;
	audio.play().catch(() => {});
}

function renderResultBanner() {
	const result = getResultView();
	elements.resultKicker.textContent = result.kicker;
	elements.resultTitle.textContent = result.title;
	elements.resultDetail.textContent = result.detail;
	elements.resultBanner.className = `result-banner ${result.tone}`;
}

function handleResultSound(previousRoom, nextRoom) {
	const game = nextRoom?.gameState;
	if (!nextRoom || game?.gameStatus !== "finished") {
		if (!nextRoom || game?.gameStatus === "waiting") state.lastResultKey = null;
		return;
	}

	const resultKey = `${nextRoom.id}:${game.round}:${game.winner}`;
	const previousStatus = previousRoom?.gameState?.gameStatus;
	if (state.lastResultKey === resultKey || previousStatus === "finished") return;

	state.lastResultKey = resultKey;
	playResultSound(game.winner === "draw" ? "draw" : game.winner === state.playerSymbol ? "win" : "lose");
}

function canMove(index) {
	if (!state.room) return false;
	const game = state.room.gameState;
	return game.gameStatus === "playing" && game.currentPlayer === socket.id && game.board[index] === null;
}

function renderBoard() {
	const game = state.room?.gameState;
	elements.board.innerHTML = "";

	for (let index = 0; index < 9; index += 1) {
		const value = game?.board[index] ?? null;
		const button = document.createElement("button");
		button.className = ["cell", value ? value.toLowerCase() : "", game?.winLine.includes(index) ? "win" : ""]
			.filter(Boolean)
			.join(" ");
		button.type = "button";
		if (value) {
			const mark = document.createElement("span");
			mark.className = "cell-mark";
			mark.textContent = value;
			button.append(mark);
		}
		button.disabled = !canMove(index);
		button.setAttribute("aria-label", value ? `Square ${index + 1}, ${value}` : `Square ${index + 1}, empty`);
		button.addEventListener("click", async () => {
			const response = await emitWithAck("makeMove", { roomId: state.room.id, position: index });
			if (!response.success) toast(response.message || "Move failed.");
		});
		elements.board.append(button);
	}
}

function renderGame() {
	const room = state.room;
	const game = room?.gameState;

	elements.matchName.textContent = room?.name ?? "No room selected";
	elements.activeRoomCode.textContent = room?.id ?? "------";
	elements.roundPill.textContent = `Round ${game?.round ?? 1}`;
	elements.copyLinkButton.disabled = !room;
	elements.resetButton.disabled = !room || game?.gameStatus === "waiting";
	elements.leaveButton.disabled = !room;
	elements.statusText.textContent = getStatusText();
	renderResultBanner();

	elements.player1Symbol.textContent = getSymbolForPlayer(room?.player1);
	elements.player2Symbol.textContent = getSymbolForPlayer(room?.player2);
	elements.player1Label.textContent = `Player 1 · ${getPlayerLabel(room?.player1)}`;
	elements.player2Label.textContent = `Player 2 · ${getPlayerLabel(room?.player2)}`;
	elements.player1Wins.textContent = formatWins(room?.score?.player1 ?? 0);
	elements.player2Wins.textContent = formatWins(room?.score?.player2 ?? 0);
	elements.player1Pill.classList.toggle("active", game?.currentPlayer === room?.player1 && game?.gameStatus === "playing");
	elements.player2Pill.classList.toggle("active", game?.currentPlayer === room?.player2 && game?.gameStatus === "playing");

	renderBoard();
}

function renderRoomList(rooms) {
	state.lastRoomList = rooms;
	elements.roomList.innerHTML = "";

	if (!rooms.length) {
		const empty = document.createElement("p");
		empty.className = "room-empty";
		empty.textContent = "No public rooms yet.";
		elements.roomList.append(empty);
		return;
	}

	for (const room of rooms) {
		const card = document.createElement("article");
		card.className = "room-card";
		card.innerHTML = `
			<div>
				<h3>${escapeHtml(room.name)}</h3>
				<p>${room.id} · ${room.memberCount}/${room.maxMembers} · ${room.gameStatus}</p>
			</div>
		`;
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = room.needsPlayer ? "Join" : "Full";
		button.disabled = !room.needsPlayer;
		button.addEventListener("click", () => joinRoom(room.id));
		card.append(button);
		elements.roomList.append(card);
	}
}

function escapeHtml(value) {
	return value.replace(/[&<>"']/g, (char) => {
		const map = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#039;",
		};
		return map[char];
	});
}

async function createRoom(event) {
	event.preventDefault();
	const response = await emitWithAck("createRoom", {
		name: elements.roomName.value,
		isPrivate: elements.privateRoom.checked,
	});

	if (!response.success) {
		toast(response.message || "Could not create room.");
		return;
	}

	setRoom(response.roomData, response.playerSymbol);
	toast(`Room ${response.roomId} created.`);
}

async function joinRoom(roomId) {
	const code = roomId.trim().toUpperCase();
	if (!code) {
		toast("Enter a room code.");
		return;
	}

	const response = await emitWithAck("joinRoom", code);
	if (!response.success) {
		toast(response.message || "Could not join room.");
		return;
	}

	setRoom(response.roomData, response.playerSymbol);
	toast(`Joined ${response.roomData.id}.`);
}

elements.createForm.addEventListener("submit", createRoom);
window.addEventListener("pointerdown", primeAudio, { once: true });

elements.joinForm.addEventListener("submit", (event) => {
	event.preventDefault();
	joinRoom(elements.roomCode.value);
});

elements.resetButton.addEventListener("click", async () => {
	if (!state.room) return;
	const response = await emitWithAck("resetGame", state.room.id);
	if (!response.success) toast(response.message || "Could not reset game.");
});

elements.leaveButton.addEventListener("click", async () => {
	await emitWithAck("leaveRoom");
	state.room = null;
	state.playerSymbol = null;
	updateUrl(null);
	renderGame();
	toast("Left room.");
});

elements.copyLinkButton.addEventListener("click", async () => {
	if (!state.room) return;
	const url = new URL(window.location.href);
	url.searchParams.set("room", state.room.id);
	await navigator.clipboard.writeText(url.toString());
	toast("Invite link copied.");
});

elements.soundButton.addEventListener("click", () => {
	state.soundEnabled = !state.soundEnabled;
	elements.soundButton.textContent = state.soundEnabled ? "Sound on" : "Sound off";
	elements.soundButton.setAttribute("aria-pressed", String(state.soundEnabled));
	if (state.soundEnabled) {
		primeAudio();
		playResultSound("draw");
	}
});

socket.on("connect", () => {
	elements.connectionStatus.textContent = "Connected";
	elements.connectionStatus.classList.add("connected");
	elements.connectionStatus.classList.remove("offline");

	const roomFromUrl = new URLSearchParams(window.location.search).get("room");
	if (roomFromUrl && !state.room) {
		elements.roomCode.value = roomFromUrl.toUpperCase();
		joinRoom(roomFromUrl);
	}
});

socket.on("disconnect", () => {
	elements.connectionStatus.textContent = "Offline";
	elements.connectionStatus.classList.remove("connected");
	elements.connectionStatus.classList.add("offline");
});

socket.on("roomList", renderRoomList);

socket.on("roomState", (room) => {
	if (!state.room || state.room.id !== room.id) return;
	const previousRoom = state.room;
	state.room = room;
	handleResultSound(previousRoom, room);
	renderGame();
});

socket.on("gameStarted", (room) => {
	if (state.room?.id !== room.id) return;
	state.room = room;
	renderGame();
	toast("Match started.");
});

socket.on("gameMove", ({ gameState }) => {
	if (!state.room) return;
	const previousRoom = state.room;
	state.room = { ...state.room, gameState };
	handleResultSound(previousRoom, state.room);
	renderGame();
});

socket.on("gameReset", (room) => {
	if (state.room?.id !== room.id) return;
	state.room = room;
	state.playerSymbol = room.gameState.playerX === socket.id ? "X" : "O";
	renderGame();
	toast(`You are ${state.playerSymbol} this round.`);
});

socket.on("playerLeft", ({ message, gameState }) => {
	if (!state.room) return;
	state.room.gameState = gameState;
	state.playerSymbol = gameState.playerX === socket.id ? "X" : null;
	renderGame();
	toast(message);
});

socket.on("playerDisconnected", ({ message, gameState }) => {
	if (!state.room) return;
	state.room.gameState = gameState;
	state.playerSymbol = gameState.playerX === socket.id ? "X" : null;
	renderGame();
	toast(message);
});

renderGame();
