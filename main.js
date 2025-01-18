import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { io } from 'socket.io-client';

const socket = io('https://smartfour-server.onrender.com');
socket.on('connect', () => {
    document.getElementById("debug").innerHTML = `Connected with socket id: ${socket.id}`;
});

async function generateRoomCode() {
    try { // i completely chatGPTd this out of laziness
        const response = await fetch('./assets/words.json');
        if (!response.ok) {
            throw new Error('Failed to load the JSON file');
        }

        const words = await response.json();
        const randomIndex1 = Math.floor(Math.random() * words.length);
        const randomIndex2 = Math.floor(Math.random() * words.length);

        while (randomIndex2 === randomIndex1) {
            randomIndex2 = Math.floor(Math.random() * words.length);
        }

        const word1 = words[randomIndex1];
        const word2 = words[randomIndex2];
        return `${word1}-${word2}`;
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// #region HTML room handling
let roomCode = "";
let username = "";

document.getElementById("createRoom").addEventListener("click", function() {
    if (document.getElementById("usernameInput").value == "") {
        alert("set a username 🙄");
        return;
    }
    const acceptable = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()_+-=[];',./{}|:<>?";
    for (const char of document.getElementById("usernameInput").value) {
        if (char == " ") {
            alert("no spaces in the username because thats not how usernames were meant to be");
            return;
        }
        if (!acceptable.includes(char)) {
            alert("bro please just do a normal username");
            return;
        }
    }

    generateRoomCode().then(code => {
        roomCode = code;
        socket.emit("reset", roomCode);
        showGame(roomCode);
    }); // because it's async
});

function joinRoom() {
    if (document.getElementById("usernameInput").value == "") {
        alert("set a username 🙄");
        return;
    }

    const roomCodeInput = document.getElementById("roomCodeInput");
    if (getComputedStyle(roomCodeInput).opacity === "0") {
        roomCodeInput.style.opacity = "1"; // unhide the room code input!
        roomCodeInput.style.pointerEvents = "auto";
        return;
    }
    if (document.getElementById("roomCodeInput").value == "") {
        alert("put the code of the room youre joining in the little box pls");
        return;
    }
    const acceptable = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789~!@#$%^&*()_+-=[];',./{}|:<>?";
    for (const char of document.getElementById("usernameInput").value) {
        if (char == " ") {
            alert("no spaces in the username because wtf");
            return;
        }
        if (!acceptable.includes(char)) {
            alert("bro please just do a normal username");
            return;
        }
    }

    roomCode = document.getElementById("roomCodeInput").value.toLowerCase();
    socket.emit("validateJoin", roomCode, document.getElementById("usernameInput").value, (isGood, reason) => {
        if (isGood) {
            showGame(roomCode);
        } else {
            if (reason) alert(reason);
        }
    });
}

document.getElementById("joinRoom").addEventListener("click", joinRoom);
document.getElementById("roomCodeInput").addEventListener("keyup", e => {
    if (e.key === "Enter") joinRoom();
});

function showGame() {
    username = document.getElementById("usernameInput").value;
    if (username == "" || roomCode == "") {
        alert("nah something broke 😭 did you do a username and room code");
        return;
    }

    const removeItems = document.getElementsByClassName("remove");
    const length = removeItems.length;
    let j = 0;
    for (let i = 0; i < length; i++) {
        if (removeItems[j]) {
            removeItems[j].remove();
        } else {
            j++;
        }
    }

    renderer.domElement.style.display = ''; // unhides everything
    document.getElementById("roomCodeText").innerHTML = `Room Code: ${roomCode}`;
    document.getElementById("turnText").style.display = '';
    document.getElementById("turnText").innerHTML = "waiting for the opps";
    document.getElementById("player-container").style.display = '';
    socket.emit("boardConnect", roomCode, username);
}
// #endregion

// #region set up three.js scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.style.display = 'none'; // Hides the canvas
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableZoom = false;
controls.enableDamping = true;
controls.dampingFactor = 0.1;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(1, 1);

// more setup nobody cares
scene.background = new THREE.TextureLoader().load('./assets/game-bg.jpg');
camera.position.set(0, 5, 5);
camera.lookAt(0, 0, 0);
const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);
const directionLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionLight.position.set(4, 10, 1.5);
directionLight.target.position.set(0, 0, 0);
scene.add(directionLight);
scene.add(directionLight.target);

const whiteMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    flatShading: true
});
const blackMat = new THREE.MeshStandardMaterial({
    color: 0x202020,
    flatShading: true
});
const greenMat = new THREE.MeshStandardMaterial({
    color: 0x00ff00,
    flatShading: true
});

const boardTexture = new THREE.TextureLoader().load('./assets/board.png');
boardTexture.magFilter = THREE.NearestFilter;
boardTexture.minFilter = THREE.NearestFilter;

const boardMaterials = Array(6).fill(new THREE.MeshStandardMaterial({
    color: 0x979DA3,
    flatShading: true
}));
boardMaterials[2] = new THREE.MeshStandardMaterial({
    map: boardTexture,
    flatShading: true
});
const boardMesh = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.2, 6.2), boardMaterials);
boardMesh.position.set(0, -0.6, 0);
scene.add(boardMesh);
// #endregion

// #region actual game code
let clientBoard = Array.from({
    length: 25
}, () => []); // solely for cursor cube calculations
let clientTurnNum = 0;
let clientColor = 2; // 0=white, 1=black, 2=spectating
let enableGame = false;

let cubeMeshes = [];
let cursorCube = null;

function getIndices(event) {
    let indices = null;
    let snappedPoint = null;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    let intersectMeshes = Array.from(cubeMeshes);
    intersectMeshes.push(boardMesh);
    const intersects = raycaster.intersectObjects(intersectMeshes, true);
    if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        indices = new THREE.Vector3(
            Math.max(0, Math.min(Math.round(hitPoint.x / 1.2) + 2, 4)),
            Math.max(0, Math.min(Math.round(hitPoint.y / 1.2) + 2, 4)),
            Math.max(0, Math.min(Math.round(hitPoint.z / 1.2) + 2, 4)),
        );

        snappedPoint = new THREE.Vector3(
            (indices.x - 2) * 1.2,
            clientBoard[indices.x * 5 + indices.z].length,
            (indices.z - 2) * 1.2
        );

        if (snappedPoint.y >= 5) return [null, null];
    }
    return [indices, snappedPoint];
}

function updateClientStats(givenRoomCode, board, turnNum) {
    if (givenRoomCode != roomCode) return;
    clientTurnNum = turnNum;
    clientBoard = board.map(row => Array.from(row)); // deep copy smh
    if (turnNum % 2 == 0) {
        document.getElementById("turnText").style.color = '#ffffff';
        document.getElementById("turnText").innerHTML = 'WHITE TURN';
    } else {
        document.getElementById("turnText").style.color = '#000000';
        document.getElementById("turnText").innerHTML = 'BLACK TURN';
    }

    const length = cubeMeshes.length;
    for (let i = 0; i < length; i++) { // so we dont get stuck somehow
        scene.remove(cubeMeshes[0]); // because we want to keep the parent geometry + materials, no extra memory cleanup is needed
        cubeMeshes.shift();
    }

    // rebuild the client board
    for (let index = 0; index < board.length; index++) {
        for (let y = 0; y < board[index].length; y++) {
            let cubePos = new THREE.Vector3(
                1.2 * Math.floor(index / 5) - 2.4,
                y,
                1.2 * (index % 5) - 2.4
            );

            let cubeMat = board[index][y] % 2 == 0 ? whiteMat.clone() : blackMat.clone();
            let cube = new THREE.Mesh(new THREE.BoxGeometry(), cubeMat);
            cube.position.copy(cubePos);
            cubeMeshes.push(cube);
            scene.add(cube);
        }
    }
}
socket.on("updateClientStats", updateClientStats);

socket.on("updateClientBaseStats", (givenRoomCode, board, turnNum, players) => {
    updateClientStats(givenRoomCode, board, turnNum, players);
    let whiteName = "WHITE: nobody yet";
    let blackName = "BLACK: nobody yet";

    if (players["white"]) {
        whiteName = 'WHITE: ' + players["white"]["username"];
        if (players["white"]["username"] == username) {
            clientColor = 0;
            whiteName += " (you)";
        }
    }
    if (players["black"]) {
        blackName = 'BLACK: ' + players["black"]["username"];
        if (players["black"]["username"] == username) {
            clientColor = 1;
            blackName += " (you)";
        }
    }
    if (clientColor == 2) {
        document.getElementById("screenText").innerHTML = 'SPECTATING';
    }

    document.getElementById("whiteText").innerHTML = whiteName;
    document.getElementById("blackText").innerHTML = blackName;
    if (players["white"] && players["black"]) {
        enableGame = true;
        if (turnNum % 2 == 0) {
            document.getElementById("turnText").style.color = '#ffffff';
            document.getElementById("turnText").innerHTML = 'WHITE TURN';
        } else {
            document.getElementById("turnText").style.color = '#000000';
            document.getElementById("turnText").innerHTML = 'BLACK TURN';
        }
        document.getElementById("turnText").style.display = '';
    }
    if (players["spectators"]) {
        let specText = "";
        for (const spectator of players["spectators"]) {
            specText += `${spectator["username"]}${(spectator["username"] == username ? ' (you)' : '')}\n`;
        }
        document.getElementById("specText").innerHTML = specText;
    }
});

socket.on("gameWin", (roomCode, winData) => {
    document.getElementById("turnText").style.color = "#00ff00";
    document.getElementById("turnText").innerHTML = (clientTurnNum % 2 == 1 ? "WHITE" : "BLACK") + " WINS!";

    const [index, x, y, z, L] = winData; // light the mfs up green
    for (let i = 0; i < 4; i++) {
        const cubeCoord = new THREE.Vector3(
            (Math.floor(index / 5) + x * i - 2) * 1.2,
            L + y * i - 1,
            ((index % 5) + z * i - 2) * 1.2
        );

        cubeMeshes.forEach((cube) => {
            if (cube.position.distanceTo(cubeCoord) < 0.01) cube.material = greenMat;
        });
    }
    enableGame = false;
});
// #endregion

// #region mouse event listeners
let isDrag = false;
let dragTime = 0;
window.addEventListener('mousedown', (event) => {
    isDrag = false;
    dragTime = Date.now();
});

window.addEventListener('mousemove', (event) => {
    isDrag = true;
    if (cursorCube) scene.remove(cursorCube);
    if (clientTurnNum % 2 != clientColor) return;
    if (!enableGame) return;
    const [indices, snappedPoint] = getIndices(event);
    if (indices && snappedPoint) { // show a cursor cube of course!
        let cursorMat = clientTurnNum % 2 == 0 ? whiteMat.clone() : blackMat.clone();
        cursorMat.transparent = true;
        cursorMat.opacity = 0.5;
        cursorCube = new THREE.Mesh(new THREE.BoxGeometry(), cursorMat);
        cursorCube.position.copy(snappedPoint);
        scene.add(cursorCube);
    }
});

window.addEventListener('mouseup', (event) => {
    if (isDrag && Date.now() - dragTime > 75) return;
    if (clientTurnNum % 2 != clientColor) return;
    if (!enableGame) return;
    const [indices, snappedPoint] = getIndices(event);
    if (indices && snappedPoint) { // place an actual cube
        let index = indices.x * 5 + indices.z;
        socket.emit("place-cube", roomCode, index);
    }
});
// #endregion

// three.js animate func that runs every frame
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    controls.update();
}
animate();

// debug
window.addEventListener('keydown', (event) => {
    if (event.key == 'd' && enableGame) {
        const debug = document.getElementById("debug").style.display;
        document.getElementById("debug").style.display = (debug == '' ? 'none' : '');
    }
});