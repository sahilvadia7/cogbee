import { useEffect, useRef, useState } from "react";

export default function WebRTCRoom() {

    const localVideoRef = useRef(null);
    const remoteContainerRef = useRef(null);

    const peers = useRef({});
    const [ws, setWs] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const [roomId, setRoomId] = useState("");
    const [myId, setMyId] = useState("");
    const [createdLink, setCreatedLink] = useState("");
    const [shareLink, setShareLink] = useState("");
    const [transcript, setTranscript] = useState("");

    const recorderRef = useRef(null);
    const chunksRef = useRef([]);

    // --------------------------------------------------------
    // INIT: WebSocket + Camera
    // --------------------------------------------------------
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const room = params.get("room");

        const socket = new WebSocket(
            "wss://delmar-drearier-arvilla.ngrok-free.dev/signal"
        );

        setWs(socket);

        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((stream) => {
                setLocalStream(stream);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            });

        socket.onopen = () => {
            if (room) joinRoom(room, socket);
        };

        socket.onmessage = (msg) => {
            const data = JSON.parse(msg.data);
            handleSignal(data);
        };

        return () => socket.close();
    }, []);

    // --------------------------------------------------------
    // SIGNAL HANDLING
    // --------------------------------------------------------
    const handleSignal = async (data) => {

        if (data.type === "id") {
            setMyId(data.id);
            return;
        }

        if (data.type === "peers") {
            for (let peerId of data.peers) {
                await createPeer(peerId, true);
            }
            return;
        }

        if (data.type === "offer") return handleOffer(data);
        if (data.type === "answer") return handleAnswer(data);
        if (data.type === "candidate") return handleCandidate(data);
        if (data.type === "leave") return removePeer(data.from);
    };

    // --------------------------------------------------------
    // ROOM
    // --------------------------------------------------------
    const createRoom = () => {
        const id = Math.random().toString(36).substr(2, 8);
        const link = `${window.location.origin}${window.location.pathname}?room=${id}`;
        setCreatedLink(link);
    };

    const joinRoom = (id, socket = ws) => {
        setRoomId(id);

        socket.send(JSON.stringify({
            type: "join",
            roomId: id
        }));

        setShareLink(`${window.location.origin}${window.location.pathname}?room=${id}`);
    };

    // --------------------------------------------------------
    // WEBRTC PEER
    // --------------------------------------------------------
    const createPeer = async (peerId, isCaller) => {

        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
        });

        peers.current[peerId] = pc;

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                ws.send(JSON.stringify({
                    type: "candidate",
                    candidate: e.candidate,
                    to: peerId,
                    from: myId,
                }));
            }
        };

        pc.ontrack = (e) => {
            addRemoteVideo(peerId, e.streams[0]);
        };

        if (isCaller) {
            let offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(JSON.stringify({
                type: "offer",
                offer,
                to: peerId,
                from: myId
            }));
        }
    };

    const handleOffer = async (data) => {
        const peerId = data.from;

        if (!peers.current[peerId]) {
            await createPeer(peerId, false);
        }

        const pc = peers.current[peerId];
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        ws.send(JSON.stringify({
            type: "answer",
            answer,
            to: peerId,
            from: myId
        }));
    };

    const handleAnswer = async (data) => {
        const pc = peers.current[data.from];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    };

    const handleCandidate = async (data) => {
        const pc = peers.current[data.from];
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    // --------------------------------------------------------
    // REMOTE VIDEO HANDLING
    // --------------------------------------------------------
    const addRemoteVideo = (peerId, stream) => {
        let video = document.getElementById("remote-" + peerId);

        if (!video) {
            video = document.createElement("video");
            video.id = "remote-" + peerId;
            video.autoplay = true;
            video.playsInline = true;
            video.style.width = "100%";
            video.style.background = "#000";
            remoteContainerRef.current.appendChild(video);
        }

        video.srcObject = stream;
    };

    const removePeer = (peerId) => {
        const video = document.getElementById("remote-" + peerId);
        if (video) video.remove();

        if (peers.current[peerId]) peers.current[peerId].close();
        delete peers.current[peerId];
    };

    // --------------------------------------------------------
    // RECORDING
    // --------------------------------------------------------
    const startRecording = () => {
        chunksRef.current = [];

        recorderRef.current = new MediaRecorder(localStream, {
            mimeType: "video/webm"
        });

        recorderRef.current.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };

        recorderRef.current.onstop = uploadAnswer;

        recorderRef.current.start();
    };

    const stopRecording = () => recorderRef.current.stop();

    const uploadAnswer = () => {
        const blob = new Blob(chunksRef.current, { type: "video/webm" });
        const file = new File([blob], "answer.webm", { type: "video/webm" });

        const formData = new FormData();
        formData.append("file", file);

        fetch("https://delmar-drearier-arvilla.ngrok-free.dev/api/interview/answer-video", {
            method: "POST",
            body: formData,
        })
            .then((res) => res.text())
            .then((text) => setTranscript(text));
    };

    // --------------------------------------------------------
    // UI
    // --------------------------------------------------------
    return (
        <div style={{ padding: 20 }}>
            <h2>Multi-User WebRTC Room</h2>

            <button onClick={createRoom}>Create Room</button>
            {createdLink && <div style={{ marginTop: 10 }}>Share: {createdLink}</div>}

            <div style={{ marginTop: 20 }}>
                <input
                    placeholder="Enter Room ID"
                    onChange={(e) => setRoomId(e.target.value)}
                />
                <button onClick={() => joinRoom(roomId)}>Join</button>
            </div>

            {shareLink && <div style={{ marginTop: 10 }}>Invite: {shareLink}</div>}

            <div style={{ marginTop: 20 }}>
                <button onClick={startRecording}>Start Answer</button>
                <button onClick={stopRecording} style={{ marginLeft: 10 }}>Stop</button>
            </div>

            <h3>Transcript:</h3>
            <pre>{transcript}</pre>

            {/* VIDEOS */}
            <div
                ref={remoteContainerRef}
                style={{
                    display: "grid",
                    marginTop: 20,
                    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                    gap: 10,
                }}
            >
                <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ width: "100%", background: "#000" }}
                />
            </div>
        </div>
    );
}
