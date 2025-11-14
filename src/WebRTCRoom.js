import { useEffect, useRef, useState } from "react";

export default function WebRTCRoom() {
    const localVideoRef = useRef(null);
    const videosRef = useRef(null);

    const [roomId, setRoomId] = useState(null);
    const [ws, setWs] = useState(null);
    const [myId, setMyId] = useState(null);
    const [localStream, setLocalStream] = useState(null);
    const peersRef = useRef({});

    const [createdLink, setCreatedLink] = useState("");
    const [shareLink, setShareLink] = useState("");
    const [transcript, setTranscript] = useState("");

    let answerRecorder;
    let recordedChunks = [];

    // ------------------------------------------------------------
    //  INIT – WebSocket + getUserMedia
    // ------------------------------------------------------------
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const initialRoom = urlParams.get("room");
        setRoomId(initialRoom);

        const socket = new WebSocket("ws://localhost:8080/signal");
        setWs(socket);

        // Init Camera + Mic
        navigator.mediaDevices
            .getUserMedia({ video: true, audio: true })
            .then((stream) => {
                setLocalStream(stream);
                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }
            });

        socket.onopen = () => {
            if (initialRoom) joinRoom(initialRoom, socket);
        };

        socket.onmessage = (msg) => handleSocket(JSON.parse(msg.data), socket);

        return () => socket.close();
    }, []);

    // ------------------------------------------------------------
    //  SOCKET HANDLER
    // ------------------------------------------------------------
    const handleSocket = async (data, socket) => {
        if (data.type === "id") {
            setMyId(data.id);
            return;
        }

        if (data.type === "peers") {
            for (let peerId of data.peers) {
                await createPeer(peerId, true, socket);
            }
            return;
        }

        if (data.type === "offer") await handleOffer(data, socket);
        if (data.type === "answer") await handleAnswer(data);
        if (data.type === "candidate") await handleCandidate(data);
        if (data.type === "leave") removeVideo(data.from);
    };

    // ------------------------------------------------------------
    //  ROOM MANAGEMENT
    // ------------------------------------------------------------
    const createRoom = () => {
        const id = Math.random().toString(36).substring(2, 10);
        const link = `${window.location.origin}${window.location.pathname}?room=${id}`;
        setCreatedLink(link);
    };

    const joinRoom = (id, socket = ws) => {
        if (!socket) return;

        setRoomId(id);

        socket.send(
            JSON.stringify({
                type: "join",
                roomId: id,
            })
        );

        const link = `${window.location.origin}${window.location.pathname}?room=${id}`;
        setShareLink(link);
    };

    // ------------------------------------------------------------
    //  WEBRTC PEERS
    // ------------------------------------------------------------
    const createPeer = async (peerId, isCaller, socket = ws) => {
        const pc = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });

        peersRef.current[peerId] = pc;

        localStream?.getTracks().forEach((track) => {
            pc.addTrack(track, localStream);
        });

        pc.onicecandidate = (e) => {
            if (e.candidate)
                socket.send(
                    JSON.stringify({
                        type: "candidate",
                        candidate: e.candidate,
                        to: peerId,
                        from: myId,
                    })
                );
        };

        pc.ontrack = (e) => addRemoteVideo(peerId, e.streams[0]);

        if (isCaller) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            socket.send(
                JSON.stringify({
                    type: "offer",
                    offer,
                    to: peerId,
                    from: myId,
                })
            );
        }
    };

    const handleOffer = async (data, socket = ws) => {
        const peerId = data.from;

        if (!peersRef.current[peerId]) {
            await createPeer(peerId, false, socket);
        }

        const pc = peersRef.current[peerId];
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.send(
            JSON.stringify({
                type: "answer",
                answer,
                to: peerId,
                from: myId,
            })
        );
    };

    const handleAnswer = async (data) => {
        const pc = peersRef.current[data.from];
        if (pc)
            await pc.setRemoteDescription(
                new RTCSessionDescription(data.answer)
            );
    };

    const handleCandidate = async (data) => {
        const pc = peersRef.current[data.from];
        if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    };

    const addRemoteVideo = (peerId, stream) => {
        let el = document.getElementById("video-" + peerId);
        if (!el) {
            el = document.createElement("video");
            el.id = "video-" + peerId;
            el.autoplay = true;
            el.playsInline = true;
            videosRef.current.appendChild(el);
        }
        el.srcObject = stream;
    };

    const removeVideo = (peerId) => {
        const el = document.getElementById("video-" + peerId);
        if (el) el.remove();
        if (peersRef.current[peerId]) peersRef.current[peerId].close();
        delete peersRef.current[peerId];
    };

    // ------------------------------------------------------------
    //  RECORDING
    // ------------------------------------------------------------
    const startRecording = () => {
        recordedChunks = [];
        answerRecorder = new MediaRecorder(localStream, {
            mimeType: "video/webm",
        });

        answerRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };

        answerRecorder.onstop = uploadAnswer;

        answerRecorder.start();
    };

    const stopRecording = () => {
        answerRecorder.stop();
    };

    const uploadAnswer = () => {
        const blob = new Blob(recordedChunks, { type: "video/webm" });
        const file = new File([blob], "answer.webm", { type: "video/webm" });

        const formData = new FormData();
        formData.append("file", file);

        fetch("http://localhost:8080/api/interview/answer-video", {
            method: "POST",
            body: formData,
        })
            .then((res) => res.text())
            .then((text) => setTranscript(text));
    };

    // ------------------------------------------------------------
    //  JSX UI
    // ------------------------------------------------------------
    return (
        <div style={{ padding: 20 }}>
            <h2>Multi-User WebRTC Demo</h2>

            <button onClick={createRoom}>Create Room</button>
            {createdLink && (
                <div style={{ background: "#eee", padding: 10, marginTop: 10 }}>
                    Room Created! Share this link:
                    <br />
                    <b>{createdLink}</b>
                </div>
            )}

            <div style={{ marginTop: 20 }}>
                <input
                    placeholder="Enter Room ID"
                    onChange={(e) => setRoomId(e.target.value)}
                />
                <button onClick={() => joinRoom(roomId)}>Join Room</button>
            </div>

            {shareLink && (
                <div style={{ background: "#eee", padding: 10, marginTop: 10 }}>
                    Invite others:
                    <br />
                    <b>{shareLink}</b>
                </div>
            )}

            <div style={{ marginTop: 20 }}>
                <button onClick={startRecording}>Start Answer</button>
                <button onClick={stopRecording} style={{ marginLeft: 10 }}>
                    Stop Answer
                </button>
            </div>

            <h3>Transcript</h3>
            <pre
                style={{
                    background: "#fff",
                    padding: 10,
                    borderRadius: 6,
                    minHeight: 40,
                }}
            >
                {transcript}
            </pre>

            <div
                ref={videosRef}
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                    gap: 16,
                    marginTop: 20,
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
